# HM Cinema on Northflank

This is a clean deployment copy of HM Cinema prepared for a Northflank web service. It uses the included Dockerfile and listens on the `PORT` environment variable.

## Deploy from GitHub

1. Create a private GitHub repository and upload the contents of this folder, including `Dockerfile`, `package.json`, and `package-lock.json`.
2. In Northflank, create a project and add a service from the GitHub repository.
3. Select **Dockerfile** as the build type. The repository root is the Docker build context.
4. Expose the HTTP service port. Northflank normally provides `PORT`; the image defaults to `5000` when running locally.
5. Set `NODE_ENV=production` and configure the variables from `.env.example` in Northflank's secret/environment settings.
6. Deploy and open the generated Northflank URL. The homepage should return HTTP 200.

## Which values are required?

- `PORT`: Northflank supplies this automatically. Do not copy the VPS value `8081`.
- `NODE_ENV`: set to `production`.
- `CANONICAL_BASE_URL`: optional. For a standby that will take over `hm-cinema.me`, use `https://hm-cinema.me`.
- `FORCE_REFERER_DOMAIN`: optional. Use `https://hm-cinema.me` when the standby is acting as the same HM Cinema site.
- `MOVIEBOX_API_HOST`: optional; the current default is `h5.aoneroom.com`.
- `RELAY_URL`, `CDN_USER_AGENT`, `ALLOW_ALL_CDN`, `ADDITIONAL_CDN_PREFIXES`: optional overrides; leave unset unless you know the VPS uses them.
- `LOK_LOK_TOKEN`: secret and optional. If the current VPS `.env` contains this variable, add its value manually in Northflank's secret settings. Do not put it in GitHub, this zip, or chat.

The generated Northflank URL is only needed for initial testing. You do not need to know it before uploading the repository. If you later attach a Northflank custom domain, update `CANONICAL_BASE_URL` only if you want that domain used for canonical links.

## Smoke checks

After deployment, check:

- `/` loads the site.
- `/sports` loads the sports page.
- `/api/sportsnow/stream` rejects requests without an allowed URL (expected HTTP 400).
- Movie and TV details load through the API.
- HLS and MP4 relay requests work from Northflank's outbound network.

## Backup deployment notes

This copy does not include `.env`, `node_modules`, logs, PIDs, or VPS backup files. It also does not copy any external database or persistent storage. If the primary VPS stores state outside this repository, back that state up separately before relying on Northflank as a failover.
