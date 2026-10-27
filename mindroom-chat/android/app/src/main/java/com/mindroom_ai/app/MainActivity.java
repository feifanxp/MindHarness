package com.mindroom_ai.app;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.plugin.SystemBars;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() == null) return;
        // Preserve viewport inset handling through a native main-document event.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                PluginHandle plugin = getBridge().getPlugin("SystemBars");
                if (plugin != null && plugin.getInstance() instanceof SystemBars) {
                    ((SystemBars) plugin.getInstance()).onDOMReady();
                }
            }
        });
    }
}
