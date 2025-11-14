// main.ts

const kv = await Deno.openKv();

const SECRET_TOKEN = Deno.env.get("SECRET_TOKEN") || "fallback-token-if-not-set-12345";
if (SECRET_TOKEN === "fallback-token-if-not-set-12345") {
  console.warn("WARNING: Using a default fallback token. For security, please set a SECRET_TOKEN environment variable.");
}
console.log("Server starting... Ready to serve video links.");

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname === "/") {
    return new Response(getHtmlPage(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (pathname === "/generate" && req.method === "POST") {
    try {
      const { url: originalUrl } = await req.json();
      if (!originalUrl || !originalUrl.startsWith("http")) {
        return new Response(JSON.stringify({ error: "Invalid URL provided." }), { status: 400 });
      }

      const videoId = crypto.randomUUID();
      await kv.set(["videos", videoId], originalUrl);

      return new Response(JSON.stringify({ videoId, token: SECRET_TOKEN }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400 });
    }
  }

  const streamPattern = new URLPattern({ pathname: "/stream/:videoId" });
  const match = streamPattern.exec(url);

  if (match) {
    const { videoId } = match.pathname.groups;
    const providedToken = url.searchParams.get("token");

    if (providedToken !== SECRET_TOKEN) {
      return new Response("Unauthorized.", { status: 401 });
    }

    const result = await kv.get<string>(["videos", videoId]);
    const originalVideoUrl = result.value;

    if (!originalVideoUrl) {
      return new Response("Video not found or link has expired.", { status: 404 });
    }
    
    try {
      const range = req.headers.get("range");
      const headers = new Headers();
      if (range) {
        headers.set("range", range);
      }

      const videoResponse = await fetch(originalVideoUrl, { headers });

      if (!videoResponse.ok || !videoResponse.body) {
        return new Response("Failed to fetch video from source.", { status: videoResponse.status });
      }

      const responseHeaders = new Headers(videoResponse.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");

      return new Response(videoResponse.body, {
        status: videoResponse.status,
        headers: responseHeaders,
      });

    } catch (error) {
        console.error("Streaming Error:", error);
        return new Response("Internal Server Error during streaming.", { status: 500 });
    }
  }

  return new Response("Not Found.", { status: 404 });
});

function getHtmlPage(): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Video Link Generator</title>
      <style>:root{--bg-color:#1a1a1a;--text-color:#f0f0f0;--primary-color:#0af;--input-bg:#2a2a2a;--border-color:#444;--success-color:#31a34a}body{font-family:system-ui,sans-serif;background-color:var(--bg-color);color:var(--text-color);display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.container{width:90%;max-width:600px;padding:2rem;background-color:var(--input-bg);border-radius:8px;box-shadow:0 4px 15px #0003}h1{text-align:center;margin-top:0;color:var(--primary-color)}label{display:block;margin-bottom:.5rem}input[type=text]{width:100%;padding:.75rem;margin-bottom:1rem;border:1px solid var(--border-color);background-color:var(--bg-color);color:var(--text-color);border-radius:4px;box-sizing:border-box}button{width:100%;padding:.75rem;border:none;background-color:var(--primary-color);color:#fff;font-size:1rem;border-radius:4px;cursor:pointer;transition:background-color .2s}button:hover:not(:disabled){background-color:#08d}button:disabled{background-color:#555;cursor:not-allowed}.result-box{margin-top:1.5rem;display:none}.result-wrapper{display:flex}#generatedLink{flex-grow:1;background-color:#333}#copyBtn{width:auto;margin-left:.5rem;background-color:var(--success-color)}#copyBtn:hover{background-color:#267c38}</style>
    </head>
    <body>
      <div class="container">
        <h1>Persistent Video Link Generator</h1>
        <label for="originalUrl">Enter Original Video URL:</label>
        <input type="text" id="originalUrl" placeholder="https://example.com/video.mp4">
        <button id="generateBtn">Generate Link</button>
        <div class="result-box" id="resultBox">
          <label for="generatedLink">Your Permanent Secure Link:</label>
          <div class="result-wrapper">
            <input type="text" id="generatedLink" readonly>
            <button id="copyBtn">Copy</button>
          </div>
        </div>
      </div>
      <script>
        const generateBtn = document.getElementById('generateBtn');
        const copyBtn = document.getElementById('copyBtn');
        const resultBox = document.getElementById('resultBox');
        const originalUrlInput = document.getElementById('originalUrl');
        const generatedLinkInput = document.getElementById('generatedLink');

        generateBtn.addEventListener('click', async () => {
          const originalUrl = originalUrlInput.value.trim();
          if (!originalUrl) {
            alert('Please enter a video URL.');
            return;
          }

          generateBtn.disabled = true;
          generateBtn.textContent = 'Generating...';

          try {
            const response = await fetch('/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: originalUrl })
            });

            if (!response.ok) {
              const { error } = await response.json();
              throw new Error(error || 'Failed to generate link.');
            }

            const { videoId, token } = await response.json();
            const currentOrigin = window.location.origin;
            const newUrl = \`\${currentOrigin}/stream/\${videoId}?token=\${token}\`;
            
            generatedLinkInput.value = newUrl;
            resultBox.style.display = 'block';

          } catch (e) {
            alert('Error: ' + e.message);
          } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Link';
          }
        });

        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(generatedLinkInput.value).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
          });
        });
      <\/script>
    </body>
    </html>
  `;
}
