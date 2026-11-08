// Double-submit CSRF: the server mints a JS-readable csrf_token cookie on any
// /api request that lacks one (server/middlewares/requestGuards.js), and every
// unsafe method has to echo it back in this header. This module is the single
// fetch client for mutations and deliberately has no Vue/browser-startup side effects.
const UNSAFE_METHOD = /^(?:POST|PUT|PATCH|DELETE)$/i;

function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export async function api(endpoint, options = {}) {
  const method = options.method || 'GET';
  const res = await fetch(`/api${endpoint}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(UNSAFE_METHOD.test(method) ? { 'X-CSRF-Token': csrfToken() } : {}),
      ...(options.headers || {}),
    },
    ...Object.fromEntries(Object.entries(options).filter(([key])=>key!=='headers')),
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // non-JSON body (proxy/CORS error pages) — fall through to status error
  }
  if (!res.ok) {
    const error = new Error(data.message || `Request failed: ${res.status}`);
    error.status = res.status;
    error.code = data.code;
    // The rest of the answer, for a page that reads more than the message (the
    // agents a disable could not stop, UserEditPage).
    error.data = data;
    throw error;
  }
  return data;
}

// A file sent as the body of a POST, with its upload progress (a message with
// attachments looked stuck while they went up). fetch()
// reports no upload progress, so this one request goes by XMLHttpRequest, with what
// api() sends (the cookie, the CSRF header) and the same answer and error.
export function apiUpload(endpoint, body, { headers = {}, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${endpoint}`);
    xhr.withCredentials = true;
    for (const [name, value] of Object.entries({ 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken(), ...headers })) xhr.setRequestHeader(name, value);
    if (onProgress) xhr.upload.onprogress = (event) => { if (event.lengthComputable && event.total) onProgress(event.loaded / event.total); };
    // As fetch() rejects when the request never got an answer.
    xhr.onerror = () => reject(new TypeError('Failed to fetch'));
    xhr.onabort = () => reject(new TypeError('Failed to fetch'));
    xhr.onload = () => {
      const text = xhr.responseText;
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        // non-JSON body — fall through to status error, as api() does
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const error = new Error(data.message || `Request failed: ${xhr.status}`);
        error.status = xhr.status;
        error.code = data.code;
        error.data = data;
        reject(error);
        return;
      }
      resolve(data);
    };
    xhr.send(body);
  });
}
