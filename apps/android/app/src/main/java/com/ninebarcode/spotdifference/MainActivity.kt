package com.ninebarcode.spotdifference

import android.app.Activity
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {
    private lateinit var gameView: WebView
    private val assetHost = "appassets.androidplatform.net"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val loader = WebViewAssetLoader.Builder()
            .setDomain(assetHost)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        gameView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? =
                    if (request.url.scheme == "https" && request.url.host == assetHost) {
                        loader.shouldInterceptRequest(request.url)
                    } else {
                        null
                    }

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean = request.url.host != assetHost
            }

            loadUrl("https://appassets.androidplatform.net/index.html")
        }

        setContentView(gameView)
    }

    override fun onPause() {
        gameView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        gameView.onResume()
    }

    override fun onDestroy() {
        gameView.destroy()
        super.onDestroy()
    }
}
