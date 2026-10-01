package com.ninebarcode.spotdifference

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.WindowInsets
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {
    private lateinit var gameView: WebView
    private val assetHost = "appassets.androidplatform.net"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // 모든 버전에서 같은 방식(앱이 시스템 바 영역까지 그리고 아래 container가 비워 둠)으로 맞춘다.
            window.setDecorFitsSystemWindows(false)
        }

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

            loadUrl("https://$assetHost/index.html")
        }

        // Android 15(API 35)부터는 앱이 상태바·내비게이션 바 아래까지 그려진다.
        // 게임 화면이 가려지지 않도록 시스템 바와 화면 노치만큼 안쪽에 둔다.
        val container = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#F8F7F4"))
            addView(gameView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
            setOnApplyWindowInsetsListener { view, insets ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                }
                insets
            }
        }

        setContentView(container)
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
