// main.ts

import { getCookies } from "https://deno.land/std@0.224.0/http/cookie.ts";

const kv = await Deno.openKv();

const SECRET_TOKEN = Deno.env.get("SECRET_TOKEN") || "fallback-token-if-not-set-12345";
if (SECRET_TOKEN === "fallback-token-if-not-set-12345") {
  console.warn("WARNING: Using a default fallback token. For security, please set a SECRET_TOKEN environment variable.");
}
console.log("Server starting with clean URL and cookie authentication...");

// Helper function to create a URL-friendly slug from a movie name
function slugify(text: string): string {
    const a = 'àáâäæãåāăąçćčđďèéêëēėęěğǵḧîïíīįìłḿñńǹňôöòóœøōõőṕŕřßśšşșťțûüùúūǘůűųẃẍÿýžźż·/_,:;'
    const b = 'aaaaaaaaaacccddeeeeeeeegghiiiiiilmnnnnoooooooooprrsssssttuuuuuuuuuwxyyzzz------'
    const p = new RegExp(a.split('').join('|'), 'g')

    return text.toString().toLowerCase()
        .replace(/\s+/g, '-') // Replace spaces with -
        .replace(p, c => b.charAt(a.indexOf(c))) // Replace special characters
        .replace(/&/g, '-and-') // Replace & with 'and'
        .replace(/[^\w\-.]+/g, '') // Remove all non-word chars except dot
        .replace(/\-\-+/g, '-') // Replace multiple - with single -
        .replace(/^-+/, '') // Trim - from start of text
        .replace(/-+$/, '') // Trim - from end of text
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // 1. Root URL: Show the generator page
  if (pathname === "/") {
    return new Response(getHtmlPage(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // 2. /generate Endpoint: Create a new link
  if (pathname === "/generate" && req.method === "POST") {
    try {
      const { originalUrl, movieName } = await req.json();
      if (!originalUrl || !movieName || !originalUrl.startsWith("http")) {
        return new Response(JSON.stringify({ error: "Invalid URL or Movie Name provided." }), { status: 400 });
      }

      const fileSlug = slugify(movieName);
      await kv.set(["videos", fileSlug], originalUrl);

      // Return a one-time playback link to the user
      const playbackUrl = `${url.origin}/play/${fileSlug}?t=${SECRET_TOKEN}`;
      
      return new Response(JSON.stringify({ playbackUrl }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400 });
    }
  }

  // 3. /play/{filename} Endpoint: Authorize and set cookie
  const playPattern = new URLPattern({ pathname: "/play/:filename+" });
  const playMatch = playPattern.exec(url);

  if (playMatch) {
    const oneTimeToken = url.searchParams.get("t");
    if (oneTimeToken !== SECRET_TOKEN) {
      return new Response("Unauthorized: Invalid or missing access token.", { status: 401 });
    }

    const { filename } = playMatch.pathname.groups;
    const streamUrl = `${url.origin}/stream/${filename}`;
    
    const headers = new Headers();
    headers.set("Location", streamUrl);
    // Set a secure, HTTP-only cookie that will be sent with subsequent requests
    headers.set("Set-Cookie", `auth-token=${SECRET_TOKEN}; HttpOnly; Secure; Path=/stream; SameSite=Strict; Max-Age=86400`); // 1 day expiry

    return new Response(null, {
      status: 302, // Found (Redirect)
      headers: headers,
    });
  }

  // 4. /stream/{filename} Endpoint: The actual video proxy, checks for cookie
  const streamPattern = new URLPattern({ pathname: "/stream/:filename+" });
  const streamMatch = streamPattern.exec(url);

  if (streamMatch) {
    const cookies = getCookies(req.headers);
    if (cookies["auth-token"] !== SECRET_TOKEN) {
      return new Response("Access Denied. Please use a valid playback link to start the session.", { status: 403 });
    }

    const { filename } = streamMatch.pathname.groups;
    const result = await kv.get<string>(["videos", filename]);
    const originalVideoUrl = result.value;

    if (!originalVideoUrl) {
      return new Response("Video not found.", { status: 404 });
    }
    
    // Proxying logic is the same as before
    try {
      const range = req.headers.get("range");
      const headers = new Headers();
      if (range) { headers.set("range", range); }

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
        return new Response("Internal Server Error.", { status: 500 });
    }
  }

  return new Response("Not Found.", { status: 404 });
});

// HTML Generator Page (with new "Movie Name" field)
function getHtmlPage(): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Clean URL Video Link Generator</title>
      <style>:root{--bg-color:#1a1a1a;--text-color:#f0f0f0;--primary-color:#0af;--input-bg:#2a2a2a;--border-color:#444;--success-color:#31a34a}body{font-family:system-ui,sans-serif;background-color:var(--bg-color);color:var(--text-color);display:flex;justify-content:center;align-items:center;min-height:100vh;margin:2rem 0}.container{width:90%;max-width:600px;padding:2rem;background-color:var(--input-bg);border-radius:8px;box-shadow:0 4px 15px #0003}h1{text-align:center;margin-top:0;color:var(--primary-color)}label{display:block;margin-bottom:.5rem;font-weight:bold}input[type=text]{width:100%;padding:.75rem;margin-bottom:1.5rem;border:1px solid var(--border-color);background-color:var(--bg-color);color:var(--text-color);border-radius:4px;box-sizing:border-box}button{width:100%;padding:.75rem;border:none;background-color:var(--primary-color);color:#fff;font-size:1rem;border-radius:4px;cursor:pointer;transition:background-color .2s}button:hover:not(:disabled){background-color:#08d}button:disabled{background-color:#555;cursor:not-allowed}.result-box{margin-top:1.5rem;display:none}.result-wrapper{display:flex}#generatedLink{flex-grow:1;background-color:#333}#copyBtn{width:auto;margin-left:.5rem;background-color:var(--success-color)}#copyBtn:hover{background-color:#267c38}</style>
    </head>
    <body>
      <div class="container">
        <h1>Clean URL Video Generator</h1>
        <label for="originalUrl">Enter Original Video URL:</label>
        <input type="text" id="originalUrl" placeholder="https://example.com/long-ugly-video-link.mp4">
        
        <label for="movieName">Enter Movie Name (e.g., My Movie 2025.mkv):</label>
        <input type="text" id="movieName" placeholder="the-avengers-endgame.mp4">
        
        <button id="generateBtn">Generate Playback Link</button>

        <div class="result-box" id="resultBox">
          <label for="generatedLink">Your Secure Playback Link:</label>
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
        const movieNameInput = document.getElementById('movieName');
        const generatedLinkInput = document.getElementById('generatedLink');

        generateBtn.addEventListener('click', async () => {
          const originalUrl = originalUrlInput.value.trim();
          const movieName = movieNameInput.value.trim();

          if (!originalUrl || !movieName) {
            alert('Please fill in both the original URL and the movie name.');
            return;
          }

          generateBtn.disabled = true;
          generateBtn.textContent = 'Generating...';

          try {
            const response = await fetch('/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ originalUrl, movieName })
            });

            if (!response.ok) {
              const { error } = await response.json();
              throw new Error(error || 'Failed to generate link.');
            }

            const { playbackUrl } = await response.json();
            generatedLinkInput.value = playbackUrl;
            resultBox.style.display = 'block';

          } catch (e) {
            alert('Error: ' + e.message);
          } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Playback Link';
          }
        });

        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(generatedLinkInput.value).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
          });
        });
      </script>
    </body>
    </html>
  `;
}
