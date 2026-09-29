import express from "express";
import sdk from "stremio-addon-sdk";

const { addonBuilder, getRouter } = sdk;

const app = express();
const PORT = process.env.PORT || 10000;

const API_BASE =
  process.env.DRAMABOS_BASE || "https://dramabos.live";

const API_KEY =
  process.env.DRAMABOS_API_KEY || "";

const PROVIDERS = [
  "dramabox",
  "reelshort",
  "shortmax",
  "goodshort",
  "netshort",
  "melolo",
  "flickreels",
  "dramawave",
  "freereels",
  "idrama",
  "starshort"
];

/*
==================================================
HELPERS
==================================================
*/

function listFrom(
  payload,
  keys = [
    "data",
    "results",
    "dramas",
    "episodes",
    "items",
    "list"
  ]
) {
  if (Array.isArray(payload)) {
    return payload;
  }

  for (const key of keys) {
    if (payload && Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  if (
    payload?.data &&
    typeof payload.data === "object" &&
    !Array.isArray(payload.data)
  ) {
    for (const key of keys) {
      if (Array.isArray(payload.data[key])) {
        return payload.data[key];
      }
    }
  }

  return [];
}

function apiHeaders() {
  const headers = {
    Accept: "application/json",
    "User-Agent": "Short-Drama-Hub/1.1.3"
  };

  if (API_KEY) {
    headers["x-api-key"] = API_KEY;
    headers["Authorization"] = `Bearer ${API_KEY}`;
  }

  return headers;
}

async function api(path) {
  const url = `${API_BASE}${path}`;

  console.log("DRAMABOS REQUEST:", url);

  const response = await fetch(url, {
    headers: apiHeaders()
  });

  console.log(
    "DRAMABOS STATUS:",
    response.status
  );

  const text = await response.text();

  console.log(
    "DRAMABOS RESPONSE:",
    text.substring(0, 1500)
  );

  if (!response.ok) {
    throw new Error(
      `DramaBos ${response.status}: ${text.substring(0, 800)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `DramaBos returned invalid JSON: ${text.substring(0, 800)}`
    );
  }
}

function normalizeDrama(item, provider) {
  const id =
    item?.id ??
    item?.dramaId ??
    item?.drama_id ??
    item?.slug ??
    item?.code;

  const title =
    item?.title ??
    item?.name ??
    item?.dramaName ??
    item?.drama_name ??
    "Untitled Drama";

  const poster =
    item?.cover ??
    item?.poster ??
    item?.image ??
    item?.thumbnail ??
    item?.coverUrl ??
    item?.cover_url ??
    "";

  if (!id) {
    return null;
  }

  return {
    id: `sdh:${provider}:${id}`,
    type: "series",
    name: title,
    poster,
    posterShape: "poster",
    description:
      item?.description ??
      item?.desc ??
      "",
    releaseInfo:
      item?.year ??
      item?.releaseYear ??
      undefined
  };
}

/*
==================================================
MANIFEST
==================================================
*/

const manifest = {
  id: "community.shortdramahub",
  version: "1.1.3",
  name: "Short Drama Hub",

  description:
    "Short drama catalog and streams from multiple providers via DramaBos.",

  logo:
    "https://www.dramabos.live/favicon.ico",

  resources: [
    "catalog",
    "meta",
    "stream"
  ],

  types: [
    "series"
  ],

  idPrefixes: [
    "sdh:"
  ],

  catalogs: PROVIDERS.map(
    (provider) => ({
      type: "series",
      id: `sdh-${provider}`,
      name:
        provider.charAt(0).toUpperCase() +
        provider.slice(1)
    })
  )
};

const builder =
  new addonBuilder(manifest);

/*
==================================================
CATALOG HANDLER
==================================================
*/

builder.defineCatalogHandler(
  async ({ type, id, extra }) => {

    console.log(
      "CATALOG REQUEST:",
      type,
      id,
      extra
    );

    const provider =
      id.replace("sdh-", "");

    if (!PROVIDERS.includes(provider)) {

      console.log(
        "UNKNOWN PROVIDER:",
        provider
      );

      return {
        metas: []
      };
    }

    try {

      let path;

      /*
      ------------------------------------------
      SEARCH
      ------------------------------------------
      */

      if (extra?.search) {

        const searchParam =
          provider === "shortmax" ||
          provider === "flickreels"
            ? "q"
            : "keyword";

        path =
          `/${provider}/api/v1/search?` +
          `${searchParam}=` +
          `${encodeURIComponent(extra.search)}`;

      }

      /*
      ------------------------------------------
      HOME
      ------------------------------------------
      */

      else {

        path =
          `/${provider}/api/v1/home`;

      }

      const payload =
        await api(path);

      const dramas =
        listFrom(payload);

      console.log(
        "PROVIDER:",
        provider,
        "DRAMAS:",
        dramas.length
      );

      const metas =
        dramas
          .map(
            (item) =>
              normalizeDrama(
                item,
                provider
              )
          )
          .filter(Boolean);

      console.log(
        "NORMALIZED METAS:",
        metas.length
      );

      return {
        metas
      };

    } catch (error) {

      console.error(
        "CATALOG ERROR:",
        error
      );

      return {
        metas: []
      };
    }
  }
);

/*
==================================================
META HANDLER
==================================================
*/

builder.defineMetaHandler(
  async ({ id }) => {

    console.log(
      "META REQUEST:",
      id
    );

    try {

      const parts =
        id.split(":");

      const provider =
        parts[1];

      const dramaId =
        parts
          .slice(2)
          .join(":");

      if (
        !PROVIDERS.includes(provider)
      ) {
        return {
          meta: null
        };
      }

      /*
      ------------------------------------------
      DRAMA DETAIL
      ------------------------------------------
      */

      const detail =
        await api(
          `/${provider}/api/v1/detail/${encodeURIComponent(dramaId)}`
        );

      const item =
        detail?.data ??
        detail;

      const title =
        item?.title ??
        item?.name ??
        "Untitled Drama";

      const poster =
        item?.cover ??
        item?.poster ??
        item?.image ??
        "";

      /*
      ------------------------------------------
      EPISODES
      ------------------------------------------
      */

      const episodeData =
        await api(
          `/${provider}/api/v1/episodes/${encodeURIComponent(dramaId)}`
        );

      const episodes =
        listFrom(
          episodeData,
          [
            "episodes",
            "data",
            "results",
            "items",
            "list"
          ]
        );

      /*
      ------------------------------------------
      STREMIO VIDEOS
      ------------------------------------------
      */

      const videos =
        episodes.map(
          (episode, index) => {

            const episodeId =
              episode?.id ??
              episode?.episodeId ??
              episode?.episode_id ??
              episode?.token ??
              episode?.episodeToken ??
              episode?.episode_token ??
              `${index + 1}`;

            const episodeNumber =
              Number(
                episode?.number ??
                episode?.episode ??
                episode?.ep ??
                index + 1
              );

            return {
              id:
                `${id}:${episodeId}`,

              title:
                episode?.title ??
                episode?.name ??
                `Episode ${episodeNumber}`,

              season: 1,

              episode:
                episodeNumber
            };
          }
        );

      return {

        meta: {

          id,

          type: "series",

          name: title,

          poster,

          description:
            item?.description ??
            item?.desc ??
            "",

          videos

        }

      };

    } catch (error) {

      console.error(
        "META ERROR:",
        error
      );

      return {
        meta: null
      };
    }
  }
);

/*
==================================================
STREAM HANDLER
==================================================
*/

builder.defineStreamHandler(
  async ({ id }) => {

    console.log(
      "STREAM REQUEST:",
      id
    );

    try {

      const parts =
        id.split(":");

      const provider =
        parts[1];

      const dramaId =
        parts[2];

      const episodeToken =
        parts
          .slice(3)
          .join(":");

      if (
        !PROVIDERS.includes(provider)
      ) {
        return {
          streams: []
        };
      }

      let payload;

      /*
      ------------------------------------------
      SHORTMAX
      ------------------------------------------
      */

      if (
        provider === "shortmax"
      ) {

        payload =
          await api(
            `/shortmax/api/v1/play/${encodeURIComponent(episodeToken)}`
          );

      }

      /*
      ------------------------------------------
      OTHER PROVIDERS
      ------------------------------------------
      */

      else {

        payload =
          await api(
            `/${provider}/api/v1/play/` +
            `${encodeURIComponent(dramaId)}/` +
            `${encodeURIComponent(episodeToken)}`
          );

      }

      const streamUrl =
        payload?.streamUrl ??
        payload?.url ??
        payload?.data?.streamUrl ??
        payload?.data?.url;

      if (!streamUrl) {

        console.log(
          "NO STREAM URL"
        );

        return {
          streams: []
        };
      }

      return {

        streams: [

          {
            url: streamUrl,
            title:
              "Short Drama Hub"
          }

        ]

      };

    } catch (error) {

      console.error(
        "STREAM ERROR:",
        error
      );

      return {
        streams: []
      };
    }
  }
);

/*
==================================================
HEALTH
==================================================
*/

app.get(
  "/health",
  (_req, res) => {

    res.json({

      ok: true,

      addon:
        "Short Drama Hub",

      version:
        "1.1.3",

      providerCount:
        PROVIDERS.length,

      api:
        API_BASE,

      apiKeyConfigured:
        Boolean(API_KEY)

    });

  }
);

/*
==================================================
DEBUG DRAMABOX HOME
==================================================
*/

app.get(
  "/debug/dramabox",
  async (_req, res) => {

    try {

      console.log(
        "DEBUG DRAMABOX REQUEST"
      );

      const data =
        await api(
          "/dramabox/api/v1/home"
        );

      res.json(data);

    } catch (error) {

      console.error(
        "DEBUG DRAMABOX ERROR:",
        error
      );

      res.status(500).json({

        ok: false,

        error:
          error.message

      });

    }

  }
);

/*
==================================================
DEBUG DRAMABOX SEARCH
==================================================
*/

app.get(
  "/debug/dramabox-search",
  async (_req, res) => {

    try {

      console.log(
        "DEBUG DRAMABOX SEARCH REQUEST"
      );

      const data =
        await api(
          "/dramabox/api/v1/search?keyword=love"
        );

      res.json(data);

    } catch (error) {

      console.error(
        "DEBUG DRAMABOX SEARCH ERROR:",
        error
      );

      res.status(500).json({

        ok: false,

        error:
          error.message

      });

    }

  }
);

/*
==================================================
ROOT
==================================================
*/

app.get(
  "/",
  (_req, res) => {

    res.json({

      addon:
        manifest.name,

      version:
        manifest.version,

      manifest:
        "/manifest.json",

      health:
        "/health",

      debugDramaBox:
        "/debug/dramabox",

      debugDramaBoxSearch:
        "/debug/dramabox-search"

    });

  }
);

/*
==================================================
STREMIO ROUTER
==================================================
*/

app.use(
  getRouter(
    builder.getInterface()
  )
);

/*
==================================================
START SERVER
==================================================
*/

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Short Drama Hub running on port ${PORT}`
    );

    console.log(
      `DramaBos API: ${API_BASE}`
    );

    console.log(
      `API key configured: ${Boolean(API_KEY)}`
    );

  }
);
