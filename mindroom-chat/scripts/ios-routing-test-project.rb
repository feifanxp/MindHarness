# Generate an isolated XCTest host from the shipping native sources.
# No test hooks, private WebKit APIs, or fixture resources enter the shipping app.
require 'fileutils'
require 'json'
require 'xcodeproj'

repo = File.expand_path('..', __dir__)
output = File.join(repo, '.claude/evidence/ios-routing')
FileUtils.mkdir_p(output)

project = Xcodeproj::Project.new(File.join(output, 'Routing.xcodeproj'))
host = project.new_target(:application, 'RoutingHost', :ios, '16.4')
tests = project.new_target(:unit_test_bundle, 'RoutingTests', :ios, '16.4')
tests.add_dependency(host)
ui_tests = project.new_target(:ui_test_bundle, 'NativeDiagnosticsTests', :ios, '16.4')
ui_tests.add_dependency(host)
project.root_object.attributes['TargetAttributes'] = { ui_tests.uuid => { 'TestTargetID' => host.uuid } }

[host, tests, ui_tests].each do |target|
  target.build_configurations.each do |config|
    config.build_settings.merge!(
      'PRODUCT_BUNDLE_IDENTIFIER' => "chat.mindroom.#{target.name}",
      'SWIFT_VERSION' => '5.0',
      'TARGETED_DEVICE_FAMILY' => '1,2',
      'CODE_SIGNING_ALLOWED' => 'NO',
      'ENABLE_USER_SCRIPT_SANDBOXING' => 'NO',
      'GENERATE_INFOPLIST_FILE' => 'YES'
    )
  end
end
host.build_configurations.each do |config|
  config.build_settings.merge!(
    'INFOPLIST_FILE' => File.join(repo, 'ios/App/App/Info.plist'),
    'MARKETING_VERSION' => '1.0',
    'CURRENT_PROJECT_VERSION' => '1',
    'ENABLE_TESTABILITY' => 'YES',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => 'DEBUG'
  )
end
tests.build_configurations.each do |config|
  config.build_settings.merge!(
    'TEST_HOST' => '$(BUILT_PRODUCTS_DIR)/RoutingHost.app/RoutingHost',
    'BUNDLE_LOADER' => '$(TEST_HOST)'
  )
end
ui_tests.build_configurations.each do |config|
  config.build_settings['TEST_TARGET_NAME'] = host.name
end

Dir[File.join(repo, 'ios/App/App/*.swift')].sort.each do |path|
  host.source_build_phase.add_file_reference(project.main_group.new_file(path))
end
Dir[File.join(repo, 'ios/Tests/*.swift')].sort.each do |path|
  tests.source_build_phase.add_file_reference(project.main_group.new_file(path))
end
Dir[File.join(repo, 'ios/Tests/UI/*.swift')].sort.each do |path|
  ui_tests.source_build_phase.add_file_reference(project.main_group.new_file(path))
end
routes_path = File.join(output, 'web-routes.json')
system('node', File.join(repo, 'scripts/ios-routing-test-routes.mjs'), out: routes_path, exception: true)
tests.resources_build_phase.add_file_reference(project.main_group.new_file(routes_path))
canvas_fixtures_path = File.join(output, 'canvas-fixtures.json')
system('node', File.join(repo, 'scripts/ios-canvas-test-fixtures.mjs'), out: canvas_fixtures_path, exception: true)
tests.resources_build_phase.add_file_reference(project.main_group.new_file(canvas_fixtures_path))
public_folder = project.main_group.new_file(File.join(repo, 'ios/Tests/public'))
public_folder.last_known_file_type = 'folder'
host.resources_build_phase.add_file_reference(public_folder)
launch_screen = project.main_group.new_file(File.join(repo, 'ios/App/App/Base.lproj/LaunchScreen.storyboard'))
host.resources_build_phase.add_file_reference(launch_screen)
privacy_manifest = project.main_group.new_file(File.join(repo, 'ios/App/App/PrivacyInfo.xcprivacy'))
host.resources_build_phase.add_file_reference(privacy_manifest)
config_path = File.join(output, 'capacitor.config.json')
File.write(config_path, JSON.generate({ appId: 'chat.mindroom.RoutingHost', loggingBehavior: 'production' }))
host.resources_build_phase.add_file_reference(project.main_group.new_file(config_path))
project.save

scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(host, tests, launch_target: true)
scheme.add_build_target(ui_tests, false)
scheme.add_test_target(ui_tests)
scheme.save_as(project.path, 'Routing', true)

capacitor_path = File.join(repo, 'node_modules/@capacitor/ios')
File.write(File.join(output, 'Podfile'), <<~PODFILE)
  platform :ios, '16.4'
  use_frameworks!
  target 'RoutingHost' do
    pod 'Capacitor', :path => #{capacitor_path.inspect}
    pod 'CapacitorCordova', :path => #{capacitor_path.inspect}
    target 'RoutingTests' do
      inherit! :search_paths
    end
  end
PODFILE
