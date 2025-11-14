// main.ts

import { getCookies } from "https://deno.land/std@0.224.0/http/cookie.ts";

const kv = await Deno.openKv();

const SECRET_TOKEN = Deno.env.get("SECRET_TOKEN") || "fallback-token-if-not-set-12345";
if (SECRET_TOKEN === "fallback-token-if-not-set-12345") {
  console.warn("WARNING: Using a default fallback token. For security, please set a SECRET_TOKEN environment variable.");
}
console.log("Server starting with auto-suggestion and cookie authentication...");

// Helper: Cleans and extracts movie name from a URL
function extractAndCleanMovieName(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        let filename = pathname.substring(pathname.lastIndexOf('/') + 1);
        filename = decodeURIComponent(filename);
        
        // Remove file extension
        filename = filename.replace(/\.(mp4|mkv|avi|mov|webm)$/i, '');
        
        // Replace common separators with spaces
        filename = filename.replace(/[._-]/g, ' ');

        // Remove common quality/source tags (this list can be expanded)
        const noiseRegex = /\b(1080p|720p|480p|HD|4K|BluRay|WEBRip|WEB-DL|HDRip|x264|x265|HEVC|AAC|YTS|AM|MX|RARBG|TGx|\[.*?\]|\(.*?\))\b/gi;
        filename = filename.replace(noiseRegex, '');

        // Clean up multiple spaces and trim
        filename = filename.replace(/\s+/g, ' ').trim();
        
        // Capitalize words (Title Case)
        return filename.split(' ').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');

    } catch (e) {
        return ''; // Return empty if URL is invalid
    }
}


// Helper: Creates a URL-friendly slug
function slugify(text: string): string {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-.]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
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

  // --- NEW ENDPOINT ---
  // 2. /fetch-title: Suggests a movie name from a URL
  if (pathname === "/fetch-title" && req.method === "POST") {
    try {
        const { originalUrl } = await req.json();
        const suggestedName = extractAndCleanMovieName(originalUrl);
        return new Response(JSON.stringify({ suggestedName }), {
            headers: { "Content-Type": "application/json" }
        });
    } catch {
        return new Response(JSON.stringify({ suggestedName: "" }), { status: 400 });
    }
  }

  // 3. /generate Endpoint: Create a new link
  if (pathname === "/generate" && req.method === "POST") {
    try {
      const { originalUrl, movieName } = await req.json();
      if (!originalUrl || !movieName || !originalUrl.startsWith("http")) {
        return new Response(JSON.stringify({ error: "Invalid URL or Movie Name provided." }), { status: 400 });
      }

      const fileSlug = slugify(movieName);
      await kv.set(["videos", fileSlug], originalUrl);

      const playbackUrl = `${url.origin}/play/${fileSlug}?t=${SECRET_TOKEN}`;
      return new Response(JSON.stringify({ playbackUrl }), { headers: { "Content-Type": "application/json" } });

    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid request body." }), { status: 400 });
    }
  }

  // 4. /play/{filename} Endpoint: Authorize and set cookie
  const playPattern = new URLPattern({ pathname: "/play/:filename+" });
  if (playPattern.exec(url)) {
    const playMatch = playPattern.exec(url)!;
    const oneTimeToken = url.searchParams.get("t");
    if (oneTimeToken !== SECRET_TOKEN) {
      return new Response("Unauthorized: Invalid or missing access token.", { status: 401 });
    }
    const { filename } = playMatch.pathname.groups;
    const streamUrl = `${url.origin}/stream/${filename}`;
    const headers = new Headers({ "Location": streamUrl });
    headers.set("Set-Cookie", `auth-token=${SECRET_TOKEN}; HttpOnly; Secure; Path=/stream; SameSite=Strict; Max-Age=86400`); // 1 day expiry
    return new Response(null, { status: 302, headers });
  }

  // 5. /stream/{filename} Endpoint: The actual video proxy, checks for cookie
  const streamPattern = new URLPattern({ pathname: "/stream/:filename+" });
  if (streamPattern.exec(url)) {
    const streamMatch = streamPattern.exec(url)!;
    const cookies = getCookies(req.headers);
    if (cookies["auth-token"] !== SECRET_TOKEN) {
      return new Response("Access Denied. Please use a valid playback link.", { status: 403 });
    }

    const { filename } = streamMatch.pathname.groups;
    const result = await kv.get<string>(["videos", filename]);
    const originalVideoUrl = result.value;

    if (!originalVideoUrl) { return new Response("Video not found.", { status: 404 }); }
    
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
      return new Response(videoResponse.body, { status: videoResponse.status, headers: responseHeaders });

    } catch (error) {
        return new Response("Internal Server Error.", { status: 500 });
    }
  }

  return new Response("Not Found.", { status: 404 });
});

// HTML Generator Page (with auto-suggestion logic)
function getHtmlPage(): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Auto-Suggest Link Generator</title>
      <style>:root{--bg-color:#1a1a1a;--text-color:#f0f0f0;--primary-color:#0af;--input-bg:#2a2a2a;--border-color:#444;--success-color:#31a34a}body{font-family:system-ui,sans-serif;background-color:var(--bg-color);color:var(--text-color);display:flex;justify-content:center;align-items:center;min-height:100vh;margin:2rem 0}.container{width:90%;max-width:600px;padding:2rem;background-color:var(--input-bg);border-radius:8px;box-shadow:0 4px 15px #0003}h1{text-align:center;margin-top:0;color:var(--primary-color)}label{display:block;margin-bottom:.5rem;font-weight:bold}input[type=text]{width:100%;padding:.75rem;margin-bottom:1.5rem;border:1px solid var(--border-color);background-color:var(--bg-color);color:var(--text-color);border-radius:4px;box-sizing:border-box}button{width:100%;padding:.75rem;border:none;background-color:var(--primary-color);color:#fff;font-size:1rem;border-radius:4px;cursor:pointer;transition:background-color .2s}button:hover:not(:disabled){background-color:#08d}button:disabled{background-color:#555;cursor:not-allowed}.result-box{margin-top:1.5rem;display:none}.result-wrapper{display:flex}#generatedLink{flex-grow:1;background-color:#333}#copyBtn{width:auto;margin-left:.5rem;background-color:var(--success-color)}#copyBtn:hover{background-color:#267c38}</style>
    </head>
    <body>
      <div class="container">
        <h1>Auto-Suggest Video Link Generator</h1>
        <label for="originalUrl">1. Paste Original Video URL:</label>
        <input type="text" id="originalUrl" placeholder="https://example.com/The.Matrix.1999.1080p.mkv">
        
        <label for="movieName">2. Verify or Edit Movie Name (add .mp4 or .mkv):</label>
        <input type="text" id="movieName" placeholder="Will be auto-filled...">
        
        <button id="generateBtn">3. Generate Playback Link</button>

        <div class="result-box" id="resultBox">
          <label for="generatedLink">Your Secure Playback Link:</label>
          <div class="result-wrapper">
            <input type="text" id="generatedLink" readonly>
            <button id="copyBtn">Copy</button>
          </div>
        </div>
      </div>
      <script>
        const originalUrlInput = document.getElementById('originalUrl');
        const movieNameInput = document.getElementById('movieName');
        const generateBtn = document.getElementById('generateBtn');
        const copyBtn = document.getElementById('copyBtn');
        const resultBox = document.getElementById('resultBox');

        // --- NEW LOGIC: Auto-fetch title ---
        originalUrlInput.addEventListener('paste', (event) => {
            // Get pasted text to process it immediately
            const pastedText = (event.clipboardData || window.clipboardData).getData('text');
            fetchTitle(pastedText);
        });
        originalUrlInput.addEventListener('blur', () => {
            // Also fetch when user clicks away from the input
            fetchTitle(originalUrlInput.value);
        });

        async function fetchTitle(url) {
            const originalUrl = url.trim();
            if (!originalUrl.startsWith('http')) return;

            movieNameInput.value = 'Fetching name...';
            try {
                const response = await fetch('/fetch-title', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ originalUrl })
                });
                if (!response.ok) throw new Error('Server could not fetch title.');
                
                const { suggestedName } = await response.json();
                
                // Guess a file extension if not present
                const extension = originalUrl.match(/\.(mp4|mkv|avi|mov|webm)$/i);
                const finalName = suggestedName ? (suggestedName + (extension ? extension[0] : '.mp4')) : '';

                movieNameInput.value = finalName;
            } catch (e) {
                console.error(e);
                movieNameInput.value = 'Could not guess name. Please enter manually.';
            }
        }

        // --- Generate button logic (mostly the same) ---
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

            if (!response.ok) throw new Error((await response.json()).error || 'Failed to generate link.');

            const { playbackUrl } = await response.json();
            generatedLinkInput.value = playbackUrl;
            resultBox.style.display = 'block';

          } catch (e) {
            alert('Error: ' + e.message);
          } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = '3. Generate Playback Link';
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
