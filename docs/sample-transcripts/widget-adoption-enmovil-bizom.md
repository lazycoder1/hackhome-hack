# Sample Transcript: Widget Adoption Analytics for Enmovil and Bizom

Use this transcript to test the PoC intake flow for landing-page widget adoption analytics.

```text
Discovery call transcript: Widget adoption analytics for Enmovil and Bizom landing pages

Participants:
- VGS, Buyer and Product/Growth stakeholder, Convinced, vgs@getconvinced.ai
- GGS, Buyer contact and PoC approver, Convinced, ggs@getconvinced.ai
- Gautam, Solutions Engineer, Convinced
- Arjun, Product Engineer, Convinced

VGS: We have the Convinced widget deployed on multiple landing pages for Enmovil and Bizom. As a PM, I want to understand adoption: which pages are actually getting widget usage, which pages create conversations, and which pages convert visitors into email captures or demo requests.

Gautam: When you say adoption, what do you want to measure?

VGS: I care about the funnel from landing page to widget engagement. At minimum: widget session started, visitor sent first message, visitor became engaged, email captured, and book-a-demo or demo request submitted.

Arjun: The widget is deployed across Enmovil pages like the homepage, blog, case studies, contact page, partnership pages, and microsites with campaign tokens such as momentec, samsung, and ait. Bizom has deployments on demo-clones and preview pages.

VGS: I want the report broken down by company and landing page. For each landing page, show widget sessions, chat sessions, voice sessions, first-message rate, engaged-session rate, email-capture rate, demo-request rate, average messages per session, and average duration.

GGS: I do not want a dashboard that is just five tiny event counts. If the data volume is low, the dashboard should still explain what exists, what is missing, and which denominator is being used.

Gautam: Do you want chat and voice separated?

VGS: Yes. Chat and voice should be separate. For PM adoption, I want to know whether users are actually typing into chat or starting voice sessions. If voice is zero, that should be visible.

Arjun: We can use the session channel values widget_chat and widget_voice. We also store pageUrl, pageTitle, UTM data, campaign token, visitor email, message count, duration, ICP score, and demo request data in session metadata.

VGS: Good. For lead capture, count a session as email captured if the visitor has an email, if identity capture happened, if a resource request has an email, or if the demo request form includes an email.

Gautam: What counts as engaged?

VGS: For now, first message means messageCount greater than zero. Engaged means messageCount is at least three. That is not perfect, but it is enough for this PM report.

Gautam: Should the dashboard use raw PostHog event names, or should we map observed production events into business metrics?

VGS: Map observed production events into business metrics. For example, if live data uses widget_email_submitted instead of widget_email_captured, treat that as the email-capture signal and call out the mapping. If voice_only.demo_request_submitted is the real demo intent event, include it instead of showing only a placeholder widget_demo_requested count.

VGS: I also want a watchlist. Show pages with at least five widget sessions but zero email captures and zero demo requests. Those are pages where people see or open the widget but do not convert.

Arjun: Should campaign tokens be a separate section?

VGS: Yes. Campaign tokens matter a lot for Enmovil microsites and partnership pages. Show sessions, first-message rate, email captures, and demo requests by campaign token.

GGS: Filter out localhost, smoke-test, synthetic validation, admin, and preview traffic by default. If preview traffic is the only available signal, separate it clearly and label it as preview data.

Gautam: What time window should we default to?

VGS: Default to the last 30 days, but let me pass --days 7 or --days 90. Also let me choose orgs, defaulting to enmovil and bizom.

VGS: The output should be PM-readable markdown by default. I want a short PM read at the top with the most important insights, then tables for org funnel, landing pages, campaign tokens, watchlist, and daily trend. Also support JSON output later for dashboards.

GGS: For the PostHog dashboard, I want sections that answer business questions, not generic trend tiles. At minimum: org-level adoption funnel, landing-page conversion table, campaign token performance, chat versus voice split, daily trend, and a zero-conversion watchlist.

Arjun: Do we need true page-view adoption rate?

VGS: Eventually yes, but not for the first version. For now, call out the caveat that this is based on persisted widget sessions, not total page views. True page-level adoption will need a page-view denominator from web analytics.

Gautam: Should pageviews appear at all?

VGS: Yes, but only as context. Do not label pageviews as widget adoption. Widget adoption should be based on persisted widget sessions, and pageviews should be a separate denominator caveat or context tile.

Gautam: What does success look like?

VGS: I should be able to answer three questions quickly: which Enmovil and Bizom pages get the most widget usage, which pages convert into email capture or demo requests, and where adoption is weak despite sessions. If the dashboard cannot answer those questions, it should not be marked successful just because PostHog resources were created.

GGS: Send the PoC plan to ggs@getconvinced.ai and vgs@getconvinced.ai. VGS is the buyer stakeholder for the dashboard requirements, and GGS can approve the PoC plan by email if the proposed report covers these metrics.
```
