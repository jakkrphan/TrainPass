/** Sub-path the app is served under (BASE_PATH, e.g. "/attendpass"), "" at the domain root. next.config inlines it at build time. */
export const basePath = process.env.BASE_PATH ?? "";

/**
 * Prefixes an app path with basePath. Only for URLs Next does not prefix itself: plain <a>, fetch, next/image src, cookie
 * paths, Auth.js redirects and absolute links (QR, LINE, email). <Link>, redirect() and router.push already add it.
 */
export const withBasePath = (path: string) => `${basePath}${path}`;
