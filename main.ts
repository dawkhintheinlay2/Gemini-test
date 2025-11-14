// main.ts

const generateRandomToken = (length: number): string => {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
};

const SECRET_TOKEN = generateRandomToken(16);
console.log("==========================================================");
console.log("Server starting...");
console.log(`Auto-generated secret token: ${SECRET_TOKEN}`);
console.log("==========================================================");

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname === "/") {
    return new Response(getHtmlPage(SECRET_TOKEN), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (pathname === "/stream") {
    const params = url.searchParams;
    const providedToken = params.get("token");
    const videoUrl = params.get("videoUrl");

    if (!providedToken || providedToken !== SECRET_TOKEN) {
      return new Response("Unauthorized: Invalid or missing token.", { status: 401 });
    }

    if (!videoUrl) {
      return new Response("Bad Request: 'videoUrl' parameter is required.", { status: 400 });
    }

    try {
      const originalVideoUrl = decodeURIComponent(videoUrl);
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
      console.error(error);
      return new Response("Internal Server Error.", { status: 500 });
    }
  }

  return new Response("Not Found", { status: 404 });
});

function getHtmlPage(token: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Video Link Generator</title>
        <style>
            :root {
                --bg-color: #1a1a1a;
                --text-color: #f0f0f0;
                --primary-color: #007acc;
                --input-bg: #2a2a2a;
                --border-color: #444;
            }
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                background-color: var(--bg-color);
                color: var(--text-color);
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
            }
            .container {
                width: 90%;
                max-width: 600px;
                padding: 2rem;
                background-color: var(--input-bg);
                border-radius: 8px;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
            }
            h1 {
                text-align: center;
                margin-top: 0;
                color: var(--primary-color);
            }
            label {
                display: block;
                margin-bottom: 0.5rem;
            }
            input[type="text"] {
                width: 100%;
                padding: 0.75rem;
                margin-bottom: 1rem;
                border: 1px solid var(--border-color);
                background-color: var(--bg-color);
                color: var(--text-color);
                border-radius: 4px;
                box-sizing: border-box;
            }
            button {
                width: 100%;
                padding: 0.75rem;
                border: none;
                background-color: var(--primary-color);
                color: white;
                font-size: 1rem;
                border-radius: 4px;
                cursor: pointer;
                transition: background-color 0.2s;
            }
            button:hover {
                background-color: #005fa3;
            }
            .result-box {
                margin-top: 1.5rem;
                display: none;
            }
            .result-wrapper {
                display: flex;
            }
            #generatedLink {
                flex-grow: 1;
                background-color: #333;
            }
            #copyBtn {
                width: auto;
                margin-left: 0.5rem;
                background-color: #31a34a;
            }
             #copyBtn:hover {
                background-color: #267c38;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Secure Video Link Generator</h1>
            <label for="originalUrl">Enter Original Video URL:</label>
            <input type="text" id="originalUrl" placeholder="https://example.com/video.mp4">
            <button id="generateBtn">Generate Link</button>

            <div class="result-box" id="resultBox">
                <label for="generatedLink">Your Secure Link:</label>
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
            
            const SERVER_TOKEN = "${token}";

            generateBtn.addEventListener('click', () => {
                const originalUrl = originalUrlInput.value.trim();
                if (!originalUrl) {
                    alert('Please enter a video URL.');
                    return;
                }

                try {
                    const encodedUrl = encodeURIComponent(originalUrl);
                    const currentOrigin = window.location.origin;
                    const newUrl = \`\${currentOrigin}/stream?token=\${SERVER_TOKEN}&videoUrl=\${encodedUrl}\`;
                    
                    generatedLinkInput.value = newUrl;
                    resultBox.style.display = 'block';

                } catch (e) {
                    alert('The provided URL is invalid.');
                }
            });

            copyBtn.addEventListener('click', () => {
                generatedLinkInput.select();
                navigator.clipboard.writeText(generatedLinkInput.value).then(() => {
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => {
                        copyBtn.textContent = 'Copy';
                    }, 2000);
                }).catch(err => {
                    alert('Failed to copy link.');
                });
            });
        <\/script>
    </body>
    </html>
  `;
}
