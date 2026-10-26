# TahoeDogBeaches

Static homepage for [tahoedogbeaches.com](https://tahoedogbeaches.com/). Photos stay on the WordPress media library.

## Production build

```bash
npm run build
```

The build checks the page script, beach filters, photo adjacency, and that every image URL responds. It writes:

- `dist/index.html` — standalone page
- `dist/wordpress.html` — Custom HTML block for the Welcome page

`dist/` is generated and is not committed.
