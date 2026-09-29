import express from "express";
import { addonBuilder, getRouter } from "stremio-addon-sdk";

const app = express();
const PORT = process.env.PORT || 7000;
const API_BASE = (process.env.DRAMABOS_BASE || "https://dramabos.live").replace(/\/$/, "");

const PROVIDERS = [
  ["dramabox", "DramaBox"],
  ["reelshort", "ReelShort"],
  ["shortmax", "ShortMax"],
  ["goodshort", "GoodShort"],
  ["netshort", "NetShort"],
  ["melolo", "Melolo"],
  ["flickreels", "FlickReels"],
  ["dramawave", "DramaWave"],
  ["freereels", "FreeReels"],
  ["idrama", "iDrama"]
];

const providerMap = Object.fromEntries(PROVIDERS);

const manifest = {
  id: "com.shortsdrama.hub",
  version: "1.0.0",
  name: "Short Drama Hub",
  description: "DramaBox, ReelShort, ShortMax, GoodShort and other short-drama catalogs.",
  logo: "https://www.stremio.com/website/stremio-logo.png",
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  catalogs: PROVIDERS.map(([id, name]) => ({
    type: "series",
    id: `shortdrama-${id}`,
    name,
    extra: [{ name: "search", isRequired: false }]
  })),
  behaviorHints: {
    configurable: false,
    adult: false
  }
};

const builder = new addonBuilder(manifest);

function arr(x) {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.data)) return x.data;
  if (x && Array.isArray(x.results)) return x.results;
  if (x && Array.isArray(x.dramas)) return x.dramas;
  if (x && Array.isArray(x.episodes)) return x.episodes;
  return [];
}

function pick(o, keys, fallback = "") {
  for (const k of keys) {
    if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  }
  return fallback;
}

async function api(path) {
  const r = await fetch(`${API_BASE}${path}`, {
    headers: { "accept": "application/json", "user-agent": "ShortDramaHub-Stremio/1.0" }
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

function normalizeDrama(d, provider) {
  const id = String(pick(d, ["id", "bookId", "code", "dramaId"]));
  return {
    id: `${provider}:${id}`,
    type: "series",
    name: String(pick(d, ["title", "name"], "Untitled")),
    poster: pick(d, ["cover", "poster", "coverUrl", "image"]),
    description: pick(d, ["synopsis", "description", "desc"]),
    imdbRating: Number(pick(d, ["rating", "score"], 0)) || undefined,
    releaseInfo: String(pick(d, ["year", "releaseYear", "status"], "")),
    genres: Array.isArray(d.genre) ? d.genre : (typeof d.genre === "string" ? d.genre.split(",").map(s=>s.trim()) : [])
  };
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== "series" || !id.startsWith("shortdrama-")) return { metas: [] };
  const provider = id.replace("shortdrama-", "");
  if (!providerMap[provider]) return { metas: [] };

  try {
    let data;
    if (extra?.search) {
      const q = encodeURIComponent(extra.search);
      const param = provider === "shortmax" ? `q=${q}` : `keyword=${q}`;
      data = await api(`/${provider}/api/v1/search?${param}`);
    } else {
      data = await api(`/${provider}/api/v1/home`);
    }
    return { metas: arr(data).map(x => normalizeDrama(x, provider)).filter(x => x.id.split(":")[1] !== "undefined") };
  } catch (e) {
    console.error("catalog", provider, e.message);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== "series") return { meta: null };
  const [provider, dramaId] = String(id).split(":");
  if (!providerMap[provider] || !dramaId) return { meta: null };

  try {
    const data = await api(`/${provider}/api/v1/detail/${encodeURIComponent(dramaId)}`);
    const d = data.drama || data.data || data;
    const meta = normalizeDrama({ ...d, id: dramaId }, provider);
    meta.id = id;
    meta.name = pick(d, ["title", "name"], meta.name);
    meta.description = pick(d, ["synopsis", "description", "desc"], meta.description);
    meta.videos = [];
    try {
      const epData = provider === "flickreels"
        ? await api(`/flickreels/api/flickreels/allepisode?id=${encodeURIComponent(dramaId)}`)
        : await api(`/${provider}/api/v1/episodes/${encodeURIComponent(dramaId)}`);
      for (const ep of arr(epData)) {
        const n = Number(pick(ep, ["number", "episode", "ep", "index"], 0));
        if (!n) continue;
        meta.videos.push({
          id: `${id}:${n}`,
          title: String(pick(ep, ["title", "name"], `Episode ${n}`)),
          season: 1,
          episode: n,
          thumbnail: pick(ep, ["thumbnail", "cover", "image"]),
          released: ep.released
        });
      }
    } catch (e) {
      console.error("episodes", provider, e.message);
    }
    return { meta };
  } catch (e) {
    console.error("meta", provider, e.message);
    return { meta: null };
  }
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "series") return { streams: [] };
  const parts = String(id).split(":");
  if (parts.length < 3) return { streams: [] };
  const provider = parts[0];
  const dramaId = parts[1];
  const ep = Number(parts[2]);
  if (!providerMap[provider] || !dramaId || !ep) return { streams: [] };

  try {
    let data;
    if (provider === "shortmax") {
      // ShortMax may require an episode/code rather than the drama id.
      data = await api(`/${provider}/api/v1/play/${encodeURIComponent(dramaId)}`);
    } else {
      data = await api(`/${provider}/api/v1/play/${encodeURIComponent(dramaId)}/${ep}`);
    }
    const url = pick(data, ["streamUrl", "url", "playUrl", "videoUrl"]);
    if (!url) return { streams: [] };
    return {
      streams: [{
        name: `${providerMap[provider]} • Episode ${ep}`,
        title: `Episode ${ep}`,
        url,
        behaviorHints: { bingeGroup: `${provider}-${dramaId}` }
      }]
    };
  } catch (e) {
    console.error("stream", provider, e.message);
    return { streams: [] };
  }
});

app.get("/", (_req, res) => res.json({
  name: manifest.name,
  version: manifest.version,
  install: "/manifest.json",
  message: "Open /manifest.json in Stremio or use the public HTTPS URL + /manifest.json"
}));

app.use(getRouter(builder.getInterface()));

app.listen(PORT, () => {
  console.log(`Short Drama Hub listening on port ${PORT}`);
});
