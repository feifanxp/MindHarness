# Run with the same Ruby/GEM_PATH as fastlane:
# ruby fastlane/tests/release_target_test.rb
require "minitest/autorun"
require "spaceship"

module UI
  def self.user_error!(message)
    raise ArgumentError, message
  end

  def self.success(_message); end
end

class ReleaseTargetTest < Minitest::Test
  def setup
    @lanes = {}
    lanes = @lanes
    @runner = Object.new
    @runner.define_singleton_method(:default_platform) { |_name| }
    @runner.define_singleton_method(:platform) { |_name, &block| instance_eval(&block) }
    @runner.define_singleton_method(:desc) { |_description| }
    @runner.define_singleton_method(:lane) { |name, &block| lanes[name] = block }
    @runner.define_singleton_method(:private_lane) { |name, &block| lanes[name] = block }
    @runner.instance_eval(File.read(File.expand_path("../Fastfile", __dir__)))

    @app = Object.new
    @app.define_singleton_method(:id) { "app-id" }
    @app.define_singleton_method(:get_in_progress_review_submission) { |**_options| nil }
    @app.define_singleton_method(:get_edit_app_store_version) { |**_options| nil }
    live = Struct.new(:version_string).new("4.12.320")
    @app.define_singleton_method(:get_live_app_store_version) { |**_options| live }
  end

  def with_stub(model, method, result)
    original = model.method(method)
    model.define_singleton_method(method) { |*_args, **_options| result }
    yield
  ensure
    model.define_singleton_method(method, original)
  end

  def verify(internal_state, processing_state: "VALID", expired: false)
    detail = Spaceship::ConnectAPI::BuildBetaDetail.new("build-id",
      "internalBuildState" => internal_state,
      "externalBuildState" => "READY_FOR_BETA_SUBMISSION",
    )
    build = Spaceship::ConnectAPI::Build.new("build-id",
      "processingState" => processing_state,
      "expired" => expired,
      "buildBetaDetail" => detail,
    )
    with_stub(Spaceship::ConnectAPI::App, :find, @app) do
      with_stub(Spaceship::ConnectAPI::Build, :all, [build]) do
        @runner.instance_exec(
          { app_version: "4.12.334", build_number: "328" },
          &@lanes.fetch(:verify_release_target)
        )
      end
    end
  end

  def test_accepts_a_build_ready_for_testflight
    verify("READY_FOR_BETA_TESTING")
  end

  def test_accepts_a_build_already_in_testflight
    verify("IN_BETA_TESTING")
  end

  def test_rejects_every_other_internal_state
    %w[PROCESSING PROCESSING_EXCEPTION MISSING_EXPORT_COMPLIANCE EXPIRED IN_EXPORT_COMPLIANCE_REVIEW].each do |state|
      error = assert_raises(ArgumentError) { verify(state) }
      assert_includes error.message, "not ready for testing or submission"
    end
    assert_raises(ArgumentError) { verify(nil) }
  end

  def test_still_rejects_invalid_and_expired_builds_already_in_testflight
    error = assert_raises(ArgumentError) { verify("IN_BETA_TESTING", processing_state: "INVALID") }
    assert_includes error.message, "not VALID"
    error = assert_raises(ArgumentError) { verify("IN_BETA_TESTING", expired: true) }
    assert_includes error.message, "expired"
  end

  def verify_submission(state, release_type)
    version = Struct.new(:version_string, :release_type).new("4.12.421", release_type)
    submission = Struct.new(:state).new(state)
    @app.define_singleton_method(:get_edit_app_store_version) { |**_options| version }
    @app.define_singleton_method(:get_in_progress_review_submission) { |**_options| submission }
    with_stub(Spaceship::ConnectAPI::App, :find, @app) do
      @runner.instance_exec({ app_version: "4.12.421" }, &@lanes.fetch(:verify_release_submission))
    end
  end

  def test_accepts_automatic_release_in_both_submitted_states
    %w[WAITING_FOR_REVIEW IN_REVIEW].each do |state|
      verify_submission(state, "AFTER_APPROVAL")
    end
  end

  def test_rejects_manual_and_scheduled_release_after_submission
    %w[MANUAL SCHEDULED].each do |release_type|
      error = assert_raises(ArgumentError) { verify_submission("WAITING_FOR_REVIEW", release_type) }
      assert_includes error.message, "not configured for automatic release after approval"
    end
  end

  def test_release_lane_requests_automatic_release_throughout_submission
    uploads = []
    %i[sh asc_api_key verify_release_target preserve_review_access ensure_review_access verify_release_submission].each do |method|
      @runner.define_singleton_method(method) { |*_args, **_options| }
    end
    @runner.define_singleton_method(:deliver) { |**options| uploads << options }
    @runner.instance_exec(
      { app_version: "4.12.421", build_number: "415", release_notes: "Update", confirmation: "submit 4.12.421 (415) for review" },
      &@lanes.fetch(:release)
    )
    assert_equal 3, uploads.length
    assert uploads.all? { |options| options[:automatic_release] == true }
    assert_equal [false, false, true], uploads.map { |options| options[:submit_for_review] }
  end

  def test_standalone_defaults_preserve_automatic_release_without_submitting
    defaults = {}
    config = Object.new
    %i[app_identifier submit_for_review automatic_release precheck_include_in_app_purchases].each do |key|
      config.define_singleton_method(key) { |value| defaults[key] = value }
    end
    config.instance_eval(File.read(File.expand_path("../Deliverfile", __dir__)))
    assert_equal true, defaults[:automatic_release]
    assert_equal false, defaults[:submit_for_review]
  end
end
