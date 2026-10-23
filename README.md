# pharmacy-medicine-parser

Medicine query parser and PostgreSQL medicine search query builder extracted from `pharmacy-analytics`.

```js
const {
  parseMedicineQuery,
  buildMedicineSearchQuery,
  buildQueryLookupProfiles,
  buildQueryVariants,
} = require('pharmacy-medicine-parser');
```

## Development

Use Bun 1.4.4:

```sh
bun install --frozen-lockfile
bun run test
bun run format
bun run format:check
```

Formatting uses the built-in Prettier-compatible `bun fmt` introduced in
[Bun 1.4.4](https://bun.com/blog/bun-v1.4.4), configured in `bunfig.toml`.
