# Website SEO, UX, and Page Architecture Audit

## Scope

This review is based on the current Shopify theme code in this repository, with emphasis on:

- SEO foundations
- page structure and content hierarchy
- navigation and page-to-page flow
- maintainability and how easy it is to add new pages

## Executive Summary

The site already has a usable Shopify SEO baseline. It includes canonical URLs, page titles, meta descriptions when set, Open Graph tags, Twitter cards, and Organization/WebSite schema in the theme layout and header. The theme also uses responsive images and lazy loading in many places, which is a good starting point for performance and search visibility.

The main issues are structural rather than foundational:

- the page system is fragmented across many one-off JSON templates
- heading hierarchy is inconsistent and can produce multiple H1-style headings on a single page
- there is no breadcrumb system
- internal page flow is weak in places because many templates behave like standalone landing pages rather than part of a connected content journey
- some content and link data appears malformed or low quality, which can hurt trust and conversion

The biggest opportunity is to simplify the architecture: reduce the number of custom page templates, standardize reusable page sections, and build clearer content hubs so users and search engines can move naturally from broad topics to detailed pages.

## What Is Good Right Now

### Strong baseline SEO setup

The layout includes core SEO essentials:

- canonical URL output in [layout/theme.liquid](/Users/kobimason/Documents/projects/MCT_Theme/layout/theme.liquid#L8)
- page title output in [layout/theme.liquid](/Users/kobimason/Documents/projects/MCT_Theme/layout/theme.liquid#L18)
- meta description support in [layout/theme.liquid](/Users/kobimason/Documents/projects/MCT_Theme/layout/theme.liquid#L25)
- Open Graph and Twitter metadata in [snippets/meta-tags.liquid](/Users/kobimason/Documents/projects/MCT_Theme/snippets/meta-tags.liquid#L1)

This means the theme is not starting from zero. It already supports basic indexing and social sharing.

### Structured data exists

The header outputs Organization and WebSite schema in [sections/header.liquid](/Users/kobimason/Documents/projects/MCT_Theme/sections/header.liquid#L418). Product and article templates also include schema output elsewhere in the theme.

That gives search engines useful brand context and is better than many small-business sites.

### Responsive image handling is generally solid

Sections like banners, multicolumns, and multirow content use Shopify image helpers with responsive widths and lazy loading patterns. Examples:

- [sections/image-banner.liquid](/Users/kobimason/Documents/projects/MCT_Theme/sections/image-banner.liquid#L105)
- [sections/multirow.liquid](/Users/kobimason/Documents/projects/MCT_Theme/sections/multirow.liquid#L56)
- [sections/multicolumn.liquid](/Users/kobimason/Documents/projects/MCT_Theme/sections/multicolumn.liquid#L104)

This is good for performance, especially on mobile.

### Content-rich landing pages already exist

There is a lot of destination-specific and niche content in the templates directory. That is useful from an SEO perspective because it creates topic depth and long-tail coverage.

Examples include:

- destination pages
- cruise pages
- storybook itinerary pages
- FAQ content

The site clearly has enough content surface area to grow organic traffic if the structure is tightened up.

## What Is Not Working Well

### 1. Too many one-off page templates

There are 38 separate `page.*.json` templates in the repo. That is a strong sign the site is scaling by duplication rather than by reusable page patterns.

Why this is a problem:

- every new page risks becoming a one-off build
- SEO and UX consistency become harder to maintain
- fixes need to be repeated across many templates
- page creation stays slow because content and layout are tightly coupled

This is the main maintainability issue in the theme.

### 2. Heading hierarchy is inconsistent

Several reusable sections render headings as actual `<h2>` tags while allowing admins to choose a visual class like `h1`, `h0`, or `hxxl`:

- [sections/image-banner.liquid](/Users/kobimason/Documents/projects/MCT_Theme/sections/image-banner.liquid#L123)
- [sections/rich-text.liquid](/Users/kobimason/Documents/projects/MCT_Theme/sections/rich-text.liquid#L24)
- [sections/multirow.liquid](/Users/kobimason/Documents/projects/MCT_Theme/sections/multirow.liquid#L83)

That creates two issues:

- visually large headings are not guaranteed to match semantic heading levels
- templates can contain several sections configured as `h1` style, which encourages multiple competing page-level headings

This weakens content structure for accessibility, SEO clarity, and scanability.

### 3. Generic pages are not built on a strong default content model

The default [templates/page.json](/Users/kobimason/Documents/projects/MCT_Theme/templates/page.json#L1) has the standard `main-page` section disabled and instead uses a custom multicolumn layout.

That means the default page template is not acting like a reliable base for normal informational pages. It makes the overall page system harder to reason about and encourages custom-template sprawl.

### 4. No breadcrumb system

There is no breadcrumb implementation in the theme. I checked sections, snippets, templates, and assets and found no breadcrumb output or breadcrumb schema.

Why this matters:

- users have fewer cues about where they are
- it is harder to move back up to category or parent pages
- search engines get less support understanding page hierarchy

This is especially important because the site has many destination and itinerary pages that would benefit from hub-to-detail navigation.

### 5. Weak internal linking and content journey

The homepage and many landing pages behave more like blocks of promotional content than a structured content system.

Examples:

- the homepage in [templates/index.json](/Users/kobimason/Documents/projects/MCT_Theme/templates/index.json) mixes categories, external booking links, and internal landing pages without a very clear hierarchy
- several pages send users straight to off-site forms instead of moving them through internal comparison or information pages first

That can be fine for direct conversion, but it is weaker for:

- SEO crawl depth
- topic authority
- user orientation
- cross-selling between related content

### 6. Some link data is malformed

In [templates/page.disney-destinations.json](/Users/kobimason/Documents/projects/MCT_Theme/templates/page.disney-destinations.json#L60), at least two `button_link` values incorrectly include `target="_blank"` inside the URL string itself.

That is a concrete data-quality issue and can lead to broken or unreliable links.

### 7. Content quality is uneven

Some templates contain content patterns that reduce trust:

- typo-level issues
- inconsistent capitalization
- generic CTA wording like “Click Here” or “Learn More”
- heavy reliance on bold text
- external links embedded directly into rich text blocks instead of using cleaner section-level CTA patterns

This is not a theme-engine problem only, but it affects SEO and conversions because perceived quality matters.

### 8. Limited structured data for content pages

The theme includes Organization/WebSite schema and product/article schema, but there is no sign of broader schema support for content pages such as:

- BreadcrumbList
- FAQPage
- Service
- LocalBusiness

That leaves SEO opportunity on the table, especially for the FAQ page and key service landing pages.

## What Should Be Improved

### 1. Simplify the page architecture

Move from many page-specific templates to a small set of reusable page types.

Recommended page template system:

- `page.landing.json`
- `page.destination-hub.json`
- `page.destination-detail.json`
- `page.service.json`
- `page.storybook-itinerary.json`
- `page.faq.json`

The goal is not to remove flexibility. The goal is to make page creation mostly a content task rather than a layout task.

### What this would improve

- faster page creation
- better consistency across SEO elements and content blocks
- easier global design changes
- less duplication

### 2. Create a clear hub-and-spoke content structure

Right now, many pages appear to be isolated. They should be grouped into clear parent-child journeys.

Recommended structure examples:

- Home
- Theme Park Destinations
- Disney Destinations
- Disneyland California
- Walt Disney World
- Tokyo Disney Resort

And:

- Home
- Storybook Itineraries
- Cinderella Itinerary
- Lilo & Stitch Itinerary
- Lionel Messi Itinerary

Each detail page should link:

- back to its parent hub
- sideways to related pages
- forward to an enquiry or quote step

This improves both SEO and user flow.

### 3. Add breadcrumbs

Add a reusable breadcrumb snippet and render it on:

- destination pages
- itinerary pages
- blog articles
- FAQ and service pages where appropriate

Also output `BreadcrumbList` schema. This is a high-value improvement with low complexity.

### 4. Standardize heading rules

Define a simple content rule:

- one true page H1 per page
- section titles default to H2
- sub-items inside sections default to H3

Also separate semantic heading level from visual size. Right now the section settings encourage visual styling choices that can confuse content hierarchy.

### 5. Improve the default page builder experience

You want adding new pages to be easier. The best way to do that is to create reusable sections with stricter roles.

Recommended reusable sections:

- Hero with eyebrow, H1, summary, primary CTA, secondary CTA
- Intro text section
- Card grid for child pages
- Comparison or feature rows
- FAQ accordion
- Related pages section
- Final CTA section

That gives you a repeatable page system instead of custom JSON editing for every new page.

### 6. Tighten internal linking

Every major page should include at least one section for related navigation:

- related destinations
- compare cruise ships
- planning help
- FAQs
- enquiry options

This will help people move through the site more naturally instead of bouncing or exiting to an external form too early.

### 7. Improve CTA strategy

Current CTA patterns are inconsistent. Some are descriptive, some are generic, and some push immediately off-site.

Better pattern:

- top-of-funnel pages: “Compare Disney destinations”, “Explore cruises”, “See itinerary ideas”
- mid-funnel pages: “See package options”, “Compare ships”, “Read planning FAQs”
- bottom-funnel pages: “Request your quote”, “Start planning”, “Book tickets”

That aligns the CTA with where the user is in the decision process.

### 8. Add richer schema where relevant

Recommended additions:

- `BreadcrumbList` for hierarchical pages
- `FAQPage` for the FAQ template
- `Service` or `LocalBusiness` for key business/service pages if the business details support it

This should be implemented carefully and only on pages where the content truly matches the schema type.

### 9. Do a content QA pass

Several pages would benefit from editorial cleanup:

- remove malformed links
- replace vague CTA text
- fix spelling and grammar issues
- reduce over-formatting
- make page intros more concise and search-friendly

This is one of the easiest ways to improve perceived quality without a full redesign.

## What Could Be Improved Visually

The current theme is functional, but many pages likely feel section-stacked rather than intentionally designed.

### Visual issues likely affecting the experience

- pages rely heavily on repeating the same section patterns
- some landing pages are long and visually monotonous
- cards and rows often read like isolated promos rather than a guided journey
- CTA placement feels inconsistent across templates

### Visual improvements worth making

- introduce more consistent page rhythm: hero, summary, supporting sections, related pages, CTA
- use fewer oversized headings and more structured content blocks
- create clearer contrast between hub pages and detail pages
- make card grids more obviously navigational, not just decorative
- add “related content” and “next step” sections near the bottom of key landing pages

## Prioritized Action Plan

### High Priority

- fix malformed links such as the ones in [templates/page.disney-destinations.json](/Users/kobimason/Documents/projects/MCT_Theme/templates/page.disney-destinations.json#L60)
- add breadcrumbs and breadcrumb schema
- define a one-H1-per-page rule
- create a proper default landing page template and stop relying on one-off page templates

### Medium Priority

- create hub pages for major content groups
- add reusable “related pages” and “next step” sections
- clean up CTA copy across destination and itinerary pages
- add FAQ schema where appropriate

### Lower Priority

- refine visual consistency across long-form pages
- audit copy quality and tone across older templates
- review whether some pages should be merged to reduce thin or overlapping content

## Recommended Build Direction

If the goal is to improve SEO, make the site look better, and make it easier to add new pages, the best direction is:

1. reduce the number of page-specific templates
2. create a small set of reusable page types
3. add hierarchy tools like breadcrumbs and related-page sections
4. standardize headings and CTA behavior
5. clean up content and link quality

That will give you a site that is easier to maintain, easier to expand, and clearer for both users and search engines.

## Most Important Takeaway

The theme is not fundamentally broken. The main issue is that it has grown by adding pages, not by building a system for pages. If you fix the system first, SEO, design consistency, and usability will all improve together.
