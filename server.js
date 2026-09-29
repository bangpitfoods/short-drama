import express from "express";
import sdk from "stremio-addon-sdk";

const { addonBuilder, getRouter } = sdk;

const app = express();

const PORT = process.env.PORT || 7000;

const API_BASE = (
  process.env.DRAMABOS_BASE || "https://dramabos.live"
).replace(/\/$/, "");

// API key OPTIONAL.
// Jangan masukkan apa-apa kalau guna free/no-auth endpoint.
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
// MANIFEST
// ============================================================

const manifest = {
  id: "com.bangpitfoods.shortdrama",

  version: "1.1.1",

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

const builder = new addonBuilder(manifest);

// ============================================================
// HELPERS
// ============================================================

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
  // Response terus array
  if (Array.isArray(payload)) {
    return payload;
  }

  // Contoh:
  // { data: [...] }
  // { results: [...] }
  // { dramas: [...] }
  // { episodes: [...] }
  for (const key of keys) {
    if (
      payload &&
      Array.isArray(payload[key])
    ) {
      return payload[key];
    }
  }

  // Contoh:
  // { data: { results: [...] } }
  // { data: { items: [...] } }
  if (
    payload?.data &&
    typeof payload.data === "object" &&
    !Array.isArray(payload.data)
  ) {
    for (const key of keys) {
      if (
        Array.isArray(
          payload.data[key]
        )
      ) {
        return payload.data[key];
      }
    }
  }

  return [];
}

// ============================================================
// VALUE HELPER
// ============================================================

function val(
  object,
  keys,
  fallback = ""
) {
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

// ============================================================
// GENRE
// ============================================================

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
    "user-agent": "ShortDramaHub/1.1.1",

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

  console.log(
    "===================================="
  );

  console.log(
    "DRAMABOS REQUEST:",
    url
  );

  const response = await fetch(
    url,
    {
      method: "GET",
      headers: apiHeaders()
    }
  );

  const body =
    await response.text();

  console.log(
    "DRAMABOS STATUS:",
    response.status
  );

  console.log(
    "DRAMABOS RESPONSE:",
    body.slice(0, 1000)
  );

  if (!response.ok) {
    throw new Error(
      `DramaBos ${response.status}: ${body.slice(
        0,
        500
      )}`
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

function normalizeDrama(
  drama,
  provider
) {
  const dramaId = String(
    val(
      drama,
      [
        "id",
        "bookId",
        "dramaId",
        "code",
        "book_id",
        "drama_id"
      ]
    )
  );

  const title = String(
    val(
      drama,
      [
        "title",
        "name",
        "bookName",
        "dramaName"
      ],
      "Untitled"
    )
  );

  const poster = val(
    drama,
    [
      "cover",
      "poster",
      "coverUrl",
      "cover_url",
      "image",
      "thumbnail"
    ]
  );

  const background = val(
    drama,
    [
      "background",
      "backdrop",
      "backgroundUrl",
      "cover"
    ]
  );

  const description = val(
    drama,
    [
      "synopsis",
      "description",
      "desc",
      "summary"
    ]
  );

  const genres = arrGenre(
    val(
      drama,
      [
        "genre",
        "genres",
        "category",
        "categories"
      ],
      []
    )
  );

  const year = val(
    drama,
    [
      "year",
      "releaseYear",
      "release_year"
    ]
  );

  const rating = Number(
    val(
      drama,
      [
        "rating",
        "score",
        "imdbRating"
      ],
      0
    )
  );

  return {
    id:
      `sdh:${provider}:${encodeURIComponent(
        dramaId
      )}`,

    type: "series",

    name: title,

    poster:
      poster || undefined,

    background:
      background || undefined,

    description:
      description || undefined,

    genres,

    releaseInfo:
      String(year || ""),

    ...(rating
      ? {
          imdbRating: rating
        }
      : {})
  };
}

// ============================================================
// CATALOG HANDLER
// ============================================================

builder.defineCatalogHandler(
  async ({
    type,
    id,
    extra
  }) => {

    if (
      type !== "series" ||
      !id.startsWith("sdh-")
    ) {
      return {
        metas: []
      };
    }

    const provider =
      id.slice(4);

    if (
      !providerNames[provider]
    ) {
      return {
        metas: []
      };
    }

    try {

      let path;

      // ======================================================
      // SEARCH
      // ======================================================

      if (
        extra?.search
      ) {

        const query =
          encodeURIComponent(
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

      // ======================================================
      // HOME
      // ======================================================

      else {

        path =
          `/${provider}/api/v1/home`;

      }

      const data =
        await api(path);

      const dramas =
        listFrom(data);

      console.log(
        "PROVIDER:",
        provider
      );

      console.log(
        "DRAMA COUNT:",
        dramas.length
      );

      const metas =
        dramas
          .map(
            (drama) =>
              normalizeDrama(
                drama,
                provider
              )
          )
          .filter(
            (item) =>
              item.id &&
              item.name &&
              item.name !==
                "Untitled"
          );

      console.log(
        "STREMIO METAS:",
        metas.length
      );

      return {
        metas
      };

    } catch (error) {

      console.error(
        "===================================="
      );

      console.error(
        "CATALOG ERROR:",
        provider
      );

      console.error(
        error.message
      );

      console.error(
        "===================================="
      );

      return {
        metas: []
      };
    }
  }
);

// ============================================================
// META HANDLER
// ============================================================

builder.defineMetaHandler(
  async ({
    type,
    id
  }) => {

    if (
      type !== "series" ||
      !id.startsWith("sdh:")
    ) {
      return {
        meta: null
      };
    }

    const parts =
      id.split(":");

    const provider =
      parts[1];

    const encodedId =
      parts[2];

    if (
      !providerNames[provider] ||
      !encodedId
    ) {
      return {
        meta: null
      };
    }

    const dramaId =
      decodeURIComponent(
        encodedId
      );

    try {

      // ======================================================
      // DETAIL
      // ======================================================

      const detail =
        await api(
          `/${provider}/api/v1/detail/${encodeURIComponent(
            dramaId
          )}`
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

      // Kekalkan Stremio ID
      meta.id = id;

      // ======================================================
      // EPISODES
      // ======================================================

      let episodes;

      if (
        provider ===
        "flickreels"
      ) {

        episodes =
          await api(
            `/flickreels/api/flickreels/allepisode?id=${encodeURIComponent(
              dramaId
            )}`
          );

      } else {

        episodes =
          await api(
            `/${provider}/api/v1/episodes/${encodeURIComponent(
              dramaId
            )}`
          );
      }

      const episodeList =
        listFrom(
          episodes,
          [
            "data",
            "results",
            "episodes",
            "items",
            "list"
          ]
        );

      console.log(
        "EPISODE COUNT:",
        episodeList.length
      );

      meta.videos =
        episodeList.map(
          (
            episode,
            index
          ) => {

            const episodeNumber =
              Number(
                val(
                  episode,
                  [
                    "number",
                    "episode",
                    "ep",
                    "index",
                    "episodeNumber"
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
                    "epCode",
                    "episode_id"
                  ],
                  ""
                )
              );

            let episodeToken =
              String(
                episodeNumber
              );

            if (
              provider ===
                "shortmax" &&
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
                ) ||
                undefined,

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
// STREAM HANDLER
// ============================================================

builder.defineStreamHandler(
  async ({
    type,
    id
  }) => {

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

    if (
      parts.length < 4
    ) {
      return {
        streams: []
      };
    }

    const provider =
      parts[1];

    const dramaId =
      decodeURIComponent(
        parts[2]
      );

    const episodeToken =
      decodeURIComponent(
        parts
          .slice(3)
          .join(":")
      );

    if (
      !providerNames[provider]
    ) {
      return {
        streams: []
      };
    }

    try {

      let path;

      // ======================================================
      // SHORTMAX
      // ======================================================

      if (
        provider ===
        "shortmax"
      ) {

        path =
          `/shortmax/api/v1/play/${encodeURIComponent(
            episodeToken
          )}`;

      }

      // ======================================================
      // OTHER PROVIDERS
      // ======================================================

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
            "stream_url",
            "url",
            "playUrl",
            "play_url",
            "videoUrl",
            "video_url"
          ]
        );

      if (
        !streamUrl
      ) {

        console.error(
          "No stream URL returned"
        );

        return {
          streams: []
        };
      }

      // ======================================================
      // SUBTITLES
      // ======================================================

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
                url:
                  subtitle.url,

                lang:
                  subtitle.lang ||
                  subtitle.language ||
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
              providerNames[
                provider
              ],

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
// HEALTH
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
        API_BASE,

      apiKeyConfigured:
        Boolean(API_KEY)

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
// START
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

    console.log(
      `API key configured: ${Boolean(
        API_KEY
      )}`
    );
  }
);
