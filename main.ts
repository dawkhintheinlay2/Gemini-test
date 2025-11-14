// main.ts

import { getCookies } from "https://deno.land/std@0.224.0/http/cookie.ts";

const kv = await Deno.openKv();

// --- TWO TOKENS NOW ---
const SECRET_TOKEN = Deno.env.get("SECRET_TOKEN") || "user-token-123";
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") || "admin-token-456"; // For accessing the admin panel

console.log("Server starting with Admin Panel...");

// Helper functions (slugify, extractAndCleanMovieName) are the same as before...
function extractAndCleanMovieName(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        let filename = pathname.substring(pathname.lastIndexOf('/') + 1);
        filename = decodeURIComponent(filename).replace(/[._-]/g, ' ');
        const noiseRegex = /\b(1080p|720p|480p|HD|4K|BluRay|WEBRip|WEB-DL|HDRip|x264|x265|HEVC|AAC|YTS|AM|MX|RARBG|TGx|\[.*?\]|\(.*?\))\b/gi;
        filename = filename.replace(noiseRegex, '').replace(/\.(mp4|mkv|avi|mov|webm)$/i, '').replace(/\s+/g, ' ').trim();
        return filename.split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' ');
    } catch { return ''; }
}
function slugify(text: string): string {
    return text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-.]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = req.method;

  // --- NEW: ADMIN PANEL ROUTES ---
  // 1. Show Admin Page
  if (pathname === "/admin") {
    if (url.searchParams.get("token") !== ADMIN_TOKEN) {
      return new Response("Forbidden: Invalid Admin Token", { status: 403 });
    }
    const videos = [];
    const iterator = kv.list({ prefix: ["videos"] });
    for await (const entry of iterator) {
        videos.push({ key: entry.key[1], value: entry.value });
    }
    return new Response(getAdminPage(videos, ADMIN_TOKEN), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // 2. Handle Deletion
  if (pathname.startsWith("/delete/") && method === "DELETE") {
    if (req.headers.get("Authorization") !== `Bearer ${ADMIN_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
    }
    try {
        const slug = pathname.split('/')[2];
        if (!slug) throw new Error("Invalid slug");
        await kv.delete(["videos", decodeURIComponent(slug)]);
        return new Response(JSON.stringify({ success: true, message: `Deleted: ${slug}` }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
        return new Response(JSON.stringify({ success: false, message: e.message }), { status: 400 });
    }
  }
  
  // --- USER-FACING ROUTES (mostly unchanged) ---
  if (pathname === "/") { return new Response(getHtmlPage(), { headers: { "Content-Type": "text/html; charset=utf-8" } }); }
  if (pathname === "/fetch-title" && method === "POST") { /* ... same as before ... */ 
      const { originalUrl } = await req.json();
      return new Response(JSON.stringify({ suggestedName: extractAndCleanMovieName(originalUrl) }));
  }
  if (pathname === "/generate" && method === "POST") { /* ... same as before ... */ 
      const { originalUrl, movieName } = await req.json();
      const fileSlug = slugify(movieName);
      await kv.set(["videos", fileSlug], originalUrl);
      return new Response(JSON.stringify({ playbackUrl: `${url.origin}/play/${fileSlug}?t=${SECRET_TOKEN}` }));
  }
  const playPattern = new URLPattern({ pathname: "/play/:filename+" });
  if (playPattern.exec(url)) { /* ... same as before, sets cookie and redirects ... */
    if (url.searchParams.get("t") !== SECRET_TOKEN) return new Response("Unauthorized", { status: 401 });
    const filename = playPattern.exec(url)!.pathname.groups.filename!;
    const headers = new Headers({ "Location": `${url.origin}/stream/${filename}` });
    headers.set("Set-Cookie", `auth-token=${SECRET_TOKEN}; HttpOnly; Secure; Path=/stream; SameSite=Strict; Max-Age=86400`);
    return new Response(null, { status: 302, headers });
  }
  const streamPattern = new URLPattern({ pathname: "/stream/:filename+" });
  if (streamPattern.exec(url)) { /* ... same as before, checks cookie and streams video ... */
    if (getCookies(req.headers)["auth-token"] !== SECRET_TOKEN) return new Response("Access Denied", { status: 403 });
    const filename = streamPattern.exec(url)!.pathname.groups.filename!;
    const result = await kv.get<string>(["videos", filename]);
    if (!result.value) return new Response("Video not found", { status: 404 });
    const videoResponse = await fetch(result.value, { headers: { range: req.headers.get("range") || "" } });
    const responseHeaders = new Headers(videoResponse.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    return new Response(videoResponse.body, { status: videoResponse.status, headers: responseHeaders });
  }

  return new Response("Not Found.", { status: 404 });
});

// Generator Page HTML (no changes)
function getHtmlPage(): string {
  /* ... copy the HTML from the previous version ... */
  return `<!DOCTYPE html>...` // Same HTML as before
}

// --- NEW: Admin Page HTML ---
function getAdminPage(videos: any[], token: string): string {
    let videoListHtml = videos.length > 0 ? '' : '<tr><td colspan="3" style="text-align:center;">No videos generated yet.</td></tr>';
    for (const video of videos) {
        videoListHtml += `
            <tr id="row-${video.key}">
                <td><code>/stream/${video.key}</code></td>
                <td class="original-url">${video.value}</td>
                <td><button class="delete-btn" data-slug="${video.key}">Delete</button></td>
            </tr>
        `;
    }

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8"><title>Admin Panel - Link Management</title>
        <style>
            body{font-family:sans-serif;background:#1a1a1a;color:#f0f0f0;padding:2rem}
            table{width:100%;border-collapse:collapse}
            th,td{padding:12px;border:1px solid #444;text-align:left;vertical-align:middle}
            th{background:#0af}
            .original-url{word-break:break-all;max-width:300px}
            .delete-btn{background:#e44;color:white;border:none;padding:8px 12px;cursor:pointer;border-radius:4px}
            .delete-btn:hover{background:#c22}
        </style>
    </head>
    <body>
        <h1>Link Management Admin Panel</h1>
        <table>
            <thead><tr><th>Generated Link Path</th><th>Original URL</th><th>Action</th></tr></thead>
            <tbody>${videoListHtml}</tbody>
        </table>
        <script>
            const ADMIN_TOKEN = "${token}";
            document.body.addEventListener('click', async (event) => {
                if (event.target.classList.contains('delete-btn')) {
                    const button = event.target;
                    const slug = button.dataset.slug;
                    
                    if (confirm(\`Are you sure you want to delete the link for: \${slug}?\`)) {
                        try {
                            const response = await fetch(\`/delete/\${slug}\`, {
                                method: 'DELETE',
                                headers: { 'Authorization': \`Bearer \${ADMIN_TOKEN}\` }
                            });
                            const result = await response.json();
                            if (result.success) {
                                document.getElementById(\`row-\${slug}\`).remove();
                            } else {
                                alert('Error: ' + result.message);
                            }
                        } catch (e) {
                            alert('An error occurred: ' + e.message);
                        }
                    }
                }
            });
        <\/script>
    </body>
    </html>
    `;
}
