self.__BUILD_MANIFEST = {
  "polyfillFiles": [
    "static/chunks/polyfills.js"
  ],
  "devFiles": [
    "static/chunks/react-refresh.js"
  ],
  "ampDevFiles": [],
  "lowPriorityFiles": [],
  "rootMainFiles": [],
  "pages": {
    "/_app": [
      "static/chunks/webpack.js",
      "static/chunks/main.js",
      "static/chunks/pages/_app.js"
    ],
    "/_error": [
      "static/chunks/webpack.js",
      "static/chunks/main.js",
      "static/chunks/pages/_error.js"
    ],
    "/admin/projects": [
      "static/chunks/webpack.js",
      "static/chunks/main.js",
      "static/chunks/pages/admin/projects.js"
    ],
    "/admin/team-updates": [
      "static/chunks/webpack.js",
      "static/chunks/main.js",
      "static/chunks/pages/admin/team-updates.js"
    ],
    "/admin/teams-integration": [
      "static/chunks/webpack.js",
      "static/chunks/main.js",
      "static/chunks/pages/admin/teams-integration.js"
    ],
    "/admin/users": [
      "static/chunks/webpack.js",
      "static/chunks/main.js",
      "static/chunks/pages/admin/users.js"
    ],
    "/daily-update": [
      "static/chunks/webpack.js",
      "static/chunks/main.js",
      "static/chunks/pages/daily-update.js"
    ],
    "/dashboard": [
      "static/chunks/webpack.js",
      "static/chunks/main.js",
      "static/chunks/pages/dashboard.js"
    ]
  },
  "ampFirstPages": []
};
self.__BUILD_MANIFEST.lowPriorityFiles = [
"/static/" + process.env.__NEXT_BUILD_ID + "/_buildManifest.js",
,"/static/" + process.env.__NEXT_BUILD_ID + "/_ssgManifest.js",

];