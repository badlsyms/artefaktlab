package cz.artefaktlab.glyphlab;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.content.ClipData;
import android.net.Uri;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceError;
import android.webkit.ValueCallback;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

/** Offline WebView shell. All app content uses a synthetic HTTPS origin for IndexedDB. */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final int PICK_FILE = 701, SAVE_FILE = 702;
    private WebView web;
    private ValueCallback<Uri[]> pendingFile;
    private byte[] pendingSave;
    private String pendingName, pendingMime;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Bridge(), "GlyphAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                return !("https".equals(u.getScheme()) && HOST.equals(u.getHost()));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost())) return null;
                String path = uri.getPath();
                try {
                    if ("/assets/index.html".equals(path) || "/assets/".equals(path)) {
                        return new WebResourceResponse("text/html", "UTF-8", getAssets().open("index.html"));
                    }
                    if (path != null && path.startsWith("/systemfonts/")) {
                        String fontName = path.substring("/systemfonts/".length());
                        // No arbitrary file paths are exposed to WebView.
                        if (!fontName.matches("[A-Za-z0-9_.-]+\\.(ttf|otf|ttc|otc)")) return missing();
                        File font = findSystemFont(fontName);
                        if (font == null) return missing();
                        String mime = fontName.toLowerCase().endsWith(".otf") ? "font/otf" : "font/ttf";
                        WebResourceResponse response = new WebResourceResponse(mime, null, new FileInputStream(font));
                        response.setResponseHeaders(java.util.Collections.singletonMap("Access-Control-Allow-Origin", "*"));
                        return response;
                    }
                } catch (Exception ignored) { return missing(); }
                return missing();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFile != null) pendingFile.onReceiveValue(null);
                pendingFile = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.setType("*/*");
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(intent, PICK_FILE);
                return true;
            }
        });
        setContentView(web);
        web.loadUrl("https://" + HOST + "/assets/index.html");
    }

    private WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
          java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    private File findSystemFont(String name) {
        String[] dirs = {"/system/fonts", "/product/fonts", "/system_ext/fonts"};
        for (String dir : dirs) {
            File root = new File(dir), f = new File(root, name);
            if (f.isFile() && f.canRead()) return f;
        }
        return null;
    }

    public class Bridge {
        @JavascriptInterface public String listSystemFonts() {
            JSONArray result = new JSONArray();
            String[] dirs = {"/system/fonts", "/product/fonts", "/system_ext/fonts"};
            java.util.HashSet<String> names = new java.util.HashSet<>();
            for (String dir : dirs) {
                File[] files = new File(dir).listFiles();
                if (files == null) continue;
                for (File file : files) {
                    String n = file.getName();
                    if (file.isFile() && n.matches("[A-Za-z0-9_.-]+\\.(?i:ttf|otf|ttc|otc)") && names.add(n)) {
                        JSONObject item = new JSONObject();
                        try { item.put("name", n); item.put("url", "https://"+HOST+"/systemfonts/"+n); result.put(item); }
                        catch (Exception ignored) { }
                    }
                }
            }
            return result.toString();
        }
        @JavascriptInterface public void saveFile(String filename, String base64, String mime) {
            // Android SAF: save to user-selected directory, no broad storage permissions.
            if (base64 == null || filename == null || mime == null || base64.length() > 80_000_000) return;
            byte[] decoded;
            try { decoded = Base64.decode(base64, Base64.DEFAULT); }
            catch (Exception e) { return; }
            String safeName = filename.replaceAll("[^\\p{L}\\p{N}._ -]", "_");
            runOnUiThread(() -> {
                pendingSave = decoded;
                pendingName = safeName;
                pendingMime = mime;
                Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                save.setType(mime);
                save.addCategory(Intent.CATEGORY_OPENABLE);
                save.putExtra(Intent.EXTRA_TITLE, pendingName);
                startActivityForResult(save, SAVE_FILE);
            });
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE) {
            if (pendingFile == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null) {
                    results = new Uri[clip.getItemCount()];
                    for (int i = 0; i < results.length; i++) results[i] = clip.getItemAt(i).getUri();
                } else if (data.getData() != null) results = new Uri[]{data.getData()};
            }
            pendingFile.onReceiveValue(results);
            pendingFile = null;
        } else if (requestCode == SAVE_FILE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingSave != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    if (out != null) out.write(pendingSave);
                } catch (Exception e) { android.util.Log.e("GlyphLab", "Save failed", e); }
            }
            pendingSave = null;
        }
    }
    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}