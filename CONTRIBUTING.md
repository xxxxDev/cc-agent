# Contributing

Thanks for helping. CC Agent is a small project, so a short, focused change is the easiest to review.

## Before you start

- For a bug, open an issue with what you did, what you expected and what happened, plus the version shown at the bottom of Settings.
- For a larger change or a new feature, open an issue first so we can agree on the approach.
- For a security problem, follow [SECURITY.md](SECURITY.md) instead.

## Development

```sh
npm install
npm run dev                 # the web app with hot reload
CC_AGENT_DEV=1 npm start    # the server, trusting the dev server's page
```

The server trusts the dev server's port only with `CC_AGENT_DEV=1` (and `NODE_ENV` not
`production`); without it, no page on another port of this machine is a trusted origin.
Set it on the command line only: a `CC_AGENT_DEV` line in `server/.env` is ignored, so
the live service never picks it up by accident.

The project's test suite is maintained separately and is not part of this repository. In your pull request, describe how you checked the change: what you ran, on which platform, and what you saw. Never test against a Claude Code session or data you care about.

## Guidelines

- Match the style of the code around your change.
- Explain any behaviour you change, especially sign-in, permissions, an agent's access and anything that writes data, so it can be checked.
- Product values (the name, icons, storage keys) belong in `server/siteConfig.js`, `src/js/productConfig.js` and `public/push-config.js`, not in shared code.
- Text shown to people goes through the existing translation helpers, in English and Traditional Chinese.
- Don't commit anything from `.local/`, any `.env` file, or real keys and tokens.

By contributing, you agree that your contribution is released under the [MIT License](LICENSE).
