import express from "express";
import sdk from "stremio-addon-sdk";

const { addonBuilder, getRouter } = sdk;

const app = express();

const PORT = process.env.PORT || 7000;
const API_BASE = (
  process.env.DRAMABOS_BASE || "https://dramabos.live"
).replace(/\/$/, "");

const API_KEY = process.env.DRAMABOS_API_KEY || "";

// ============================================================
// PROVIDERS
// ============================================================

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
  ["idrama", "iDrama"],
  ["starshort", "StarShort"]
];

const providerNames = Object.fromEntries(PROVIDERS);

// ============================================================
// STREMIO MANIFEST
// ============================================================

const manifest = {
  id: "com.bangpitfoods.shortdrama",

  version: "1.1.0",

  name: "Short Drama Hub",

  description:
    "Short-drama catalogs from DramaBox, ReelShort, ShortMax, GoodShort, NetShort and more.",

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

  catalogs: PROVIDERS.map(([slug, name]) => ({
    type: "series",
    id: `sdh-${slug}`,
    name,

    extra: [
      {
        name: "search",
        isRequired: false
      }
    ]
  })),

  behaviorHints: {
    configurable: false,
    adult: false
  }
};

// ============================================================
// STREMIO ADDON
// ============================================================

const builder = new addonBuilder(manifest);

// ============================================================
// HELPERS
// ============================================================

function listFrom(payload, keys = [
  "data",
  "results",
  "dramas",
  "episodes"
]) {
  for (const key of keys) {
    if (payload && Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  return [];
}

function val(object, keys, fallback = "") {
  for (const key of keys) {
    if (
      object?.[key] !== undefined &&
      object?.[key] !== null &&
      object?.[key] !== ""
    ) {
      return object[key];
    }
  }

  return fallback;
}

function arrGenre(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  return [];
}

// ============================================================
// API HEADERS
// ============================================================

function apiHeaders() {
  return {
    accept: "application/json",
    "user-agent": "ShortDramaHub/1.1",

    ...(API_KEY
      ? {
          "x-api-key": API_KEY,
          authorization: `Bearer ${API_KEY}`
        }
      : {})
  };
}

// ============================================================
// API REQUEST
// ============================================================

async function api(path) {
  const url = API_BASE + path;

  console.log("API:", url);

  const response = await fetch(url, {
    method: "GET",
    headers: apiHeaders()
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `DramaBos ${response.status}: ${body.slice(0, 300)}`
    );
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(
      "DramaBos returned invalid JSON"
    );
  }
}

// ============================================================
// NORMALIZE DRAMA
// ============================================================

function normalizeDrama(drama, provider) {
  const dramaId = String(
    val(drama, [
      "id",
      "bookId",
      "dramaId",
      "code"
    ])
  );

  const title = String(
    val(drama, [
      "title",
      "name"
    ], "Untitled")
  );

  const poster = val(drama, [
    "cover",
    "poster",
    "coverUrl",
    "image"
  ]);

  const background = val(drama, [
    "background",
    "backdrop",
    "cover"
  ]);

  const description = val(drama, [
    "synopsis",
    "description",
    "desc"
  ]);

  const genres = arrGenre(
    val(drama, [
      "genre",
      "genres"
    ], [])
  );

  const year = val(drama, [
    "year",
    "releaseYear"
  ]);

  const rating = Number(
    val(drama, [
      "rating",
      "score"
    ], 0)
  );

  return {
    id: `sdh:${provider}:${encodeURIComponent(dramaId)}`,

    type: "series",

    name: title,

    poster: poster || undefined,

    background: background || undefined,

    description: description || undefined,

    genres,

    releaseInfo: String(year || ""),

    ...(rating
      ? {
          imdbRating: rating
        }
      : {})
  };
}

// ============================================================
// CATALOG
// ============================================================

builder.defineCatalogHandler(
  async ({ type, id, extra }) => {

    if (
      type !== "series" ||
      !id.startsWith("sdh-")
    ) {
      return {
        metas: []
      };
    }

    const provider = id.slice(4);

    if (!providerNames[provider]) {
      return {
        metas: []
      };
    }

    try {

      let path;

      // SEARCH
      if (extra?.search) {

        const query = encodeURIComponent(
          extra.search
        );

        if (
          provider === "shortmax" ||
          provider === "flickreels"
        ) {
          path =
            `/${provider}/api/v1/search?q=${query}`;
        } else {
          path =
            `/${provider}/api/v1/search?keyword=${query}`;
        }

      }

      // HOME
      else {

        path =
          `/${provider}/api/v1/home`;
      }

      const data = await api(path);

      const dramas = listFrom(data);

      const metas = dramas
        .map((drama) =>
          normalizeDrama(
            drama,
            provider
          )
        )
        .filter(
          (item) =>
            item.id &&
            item.name
        );

      return {
        metas
      };

    } catch (error) {

      console.error(
        "CATALOG ERROR:",
        provider,
        error.message
      );

      return {
        metas: []
      };
    }
  }
);

// ============================================================
// META
// ============================================================

builder.defineMetaHandler(
  async ({ type, id }) => {

    if (
      type !== "series" ||
      !id.startsWith("sdh:")
    ) {
      return {
        meta: null
      };
    }

    const parts = id.split(":");

    const provider = parts[1];

    const encodedId = parts[2];

    if (
      !providerNames[provider] ||
      !encodedId
    ) {
      return {
        meta: null
      };
    }

    const dramaId =
      decodeURIComponent(encodedId);

    try {

      // --------------------------------------------------------
      // DETAIL
      // --------------------------------------------------------

      const detail = await api(
        `/${provider}/api/v1/detail/${encodeURIComponent(dramaId)}`
      );

      const drama =
        detail?.drama ||
        detail?.data ||
        detail;

      const meta =
        normalizeDrama(
          {
            ...drama,
            id: dramaId
          },
          provider
        );

      // Keep original Stremio ID
      meta.id = id;

      // --------------------------------------------------------
      // EPISODES
      // --------------------------------------------------------

      let episodes;

      if (provider === "flickreels") {

        episodes = await api(
          `/flickreels/api/flickreels/allepisode?id=${encodeURIComponent(dramaId)}`
        );

      } else {

        episodes = await api(
          `/${provider}/api/v1/episodes/${encodeURIComponent(dramaId)}`
        );
      }

      const episodeList =
        listFrom(
          episodes,
          [
            "data",
            "results",
            "episodes"
          ]
        );

      meta.videos =
        episodeList.map(
          (episode, index) => {

            const episodeNumber =
              Number(
                val(
                  episode,
                  [
                    "number",
                    "episode",
                    "ep",
                    "index"
                  ],
                  index + 1
                )
              );

            const episodeCode =
              String(
                val(
                  episode,
                  [
                    "code",
                    "episodeCode",
                    "epCode"
                  ],
                  ""
                )
              );

            let episodeToken =
              String(episodeNumber);

            if (
              provider === "shortmax" &&
              episodeCode
            ) {
              episodeToken =
                encodeURIComponent(
                  episodeCode
                );
            }

            return {

              id:
                `${id}:${episodeToken}`,

              title:
                String(
                  val(
                    episode,
                    [
                      "title",
                      "name"
                    ],
                    `Episode ${episodeNumber}`
                  )
                ),

              season: 1,

              episode:
                episodeNumber,

              thumbnail:
                val(
                  episode,
                  [
                    "thumbnail",
                    "cover",
                    "image"
                  ]
                ) || undefined,

              overview:
                val(
                  episode,
                  [
                    "description",
                    "desc"
                  ],
                  ""
                )
            };
          }
        );

      return {
        meta
      };

    } catch (error) {

      console.error(
        "META ERROR:",
        provider,
        error.message
      );

      return {
        meta: null
      };
    }
  }
);

// ============================================================
// STREAM
// ============================================================

builder.defineStreamHandler(
  async ({ type, id }) => {

    if (
      type !== "series" ||
      !id.startsWith("sdh:")
    ) {
      return {
        streams: []
      };
    }

    const parts =
      id.split(":");

    if (parts.length < 4) {
      return {
        streams: []
      };
    }

    const provider =
      parts[1];

    const dramaId =
      decodeURIComponent(parts[2]);

    const episodeToken =
      decodeURIComponent(
        parts.slice(3).join(":")
      );

    if (!providerNames[provider]) {
      return {
        streams: []
      };
    }

    try {

      let path;

      // SHORTMAX
      if (provider === "shortmax") {

        path =
          `/shortmax/api/v1/play/${encodeURIComponent(
            episodeToken
          )}`;

      }

      // OTHER PROVIDERS
      else {

        path =
          `/${provider}/api/v1/play/${encodeURIComponent(
            dramaId
          )}/${encodeURIComponent(
            episodeToken
          )}`;
      }

      const data =
        await api(path);

      const streamUrl =
        val(
          data,
          [
            "streamUrl",
            "url",
            "playUrl",
            "videoUrl"
          ]
        );

      if (!streamUrl) {

        console.error(
          "No stream URL returned"
        );

        return {
          streams: []
        };
      }

      let subtitles;

      if (
        Array.isArray(
          data?.subtitles
        )
      ) {

        subtitles =
          data.subtitles
            .map(
              (subtitle) => ({
                url: subtitle.url,
                lang:
                  subtitle.lang ||
                  "en"
              })
            )
            .filter(
              (subtitle) =>
                subtitle.url
            );
      }

      return {

        streams: [

          {

            name:
              providerNames[provider],

            title:
              `Episode ${episodeToken}`,

            url:
              streamUrl,

            ...(subtitles
              ? {
                  subtitles
                }
              : {}),

            behaviorHints: {

              bingeGroup:
                `${provider}-${dramaId}`
            }
          }

        ]
      };

    } catch (error) {

      console.error(
        "STREAM ERROR:",
        provider,
        error.message
      );

      return {
        streams: []
      };
    }
  }
);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  "/health",
  (_req, res) => {

    res.json({
      ok: true,

      addon:
        manifest.name,

      version:
        manifest.version,

      providerCount:
        PROVIDERS.length,

      api:
        API_BASE
    });
  }
);

// ============================================================
// ROOT
// ============================================================

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
        "/health"
    });
  }
);

// ============================================================
// STREMIO ROUTER
// ============================================================

app.use(
  getRouter(
    builder.getInterface()
  )
);

// ============================================================
// START SERVER
// ============================================================

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
  }
);
