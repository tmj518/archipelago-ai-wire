VERIFYING THE SEO STUDY'S FOUR DEFECT CLAIMS
==============================================================================

1. www host
   status: 200
   CLAIM (no redirect, serves 200): CONFIRMED
   canonical it declares: https://landedmath.com/

2. HSTS
   strict-transport-security: (absent)
   CLAIM (absent): CONFIRMED

3. sitemap lastmod
   <loc> 33, <lastmod> 0
   CLAIM (0 lastmod across 33 URLs): CONFIRMED

4. images
   <img> on a live article page: 0
   public/ contents: favicon.svg, og-default.png, _headers
   <img> in the local build of that page: 0
   CLAIM (0 content images site-wide): CONFIRMED

5. robots meta on the homepage
   content: (absent)
   max-image-preview present: false
   /privacy/ robots: noindex, nofollow

6. HTML caching
   cache-control: public, max-age=0, must-revalidate
   /_astro/BaseLayout.DcpCEcV-.css cache-control: public, max-age=31536000, immutable

7. og-default.png
   dimensions: 1200x630 = 756,000 px, aspect 1.905:1
   Discover wants >=1200px wide and >300,000 px: width ok=true, area ok=true
   16:9 would be 1200x675; actual height differs by -45px

8. Article JSON-LD keys
   @type: Article
   keys : @context, @type, headline, alternativeHeadline, description, datePublished, author, publisher, articleSection, keywords, mainEntityOfPage
   has image    : false
   has author   : true -> {"@type":"Person","name":"V","jobTitle":"China Supply Chain Analyst · Shenzhen"}
   has publisher: true -> {"@type":"Organization","name":"Landed Math"}
   dateModified : (absent)   datePublished: 2026-10-07T00:00:00.000Z
