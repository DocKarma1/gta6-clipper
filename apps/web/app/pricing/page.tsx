import { PLANS } from "../../lib/plans";

export default function PricingPage() {
  return (
    <>
      <section className="hero">
        <h1>Pricing</h1>
        <p>
          Three plans. Every plan includes Live Radar, 1080p downloads, and no watermark.
          Auto-post to all four platforms is Studio only.
        </p>
      </section>
      <p className="notice">
        Do not enable checkout on Vercel Hobby. Hobby is limited to personal or
        non-commercial use (Vercel Terms of Service, Section 4). Move to Cloudflare Pages
        or Vercel Pro before charging customers. Payment processor fees are per transaction.
      </p>
      <section className="grid">
        {PLANS.map((plan) => (
          <article className="card" key={plan.id}>
            <h2>{plan.name}</h2>
            <p className="price">
              ${plan.monthlyUsd}
              <span>/mo</span>
            </p>
            <p className="muted">{plan.summary}</p>
            <ul className="list">
              <li>{plan.streamsAtOnce} live streams at once</li>
              <li>
                {plan.youtubeImportsPerMonth} YouTube imports / mo, up to {plan.youtubeMaxHours}h
              </li>
              <li>{plan.clipsPerMonth.toLocaleString()} clips / month</li>
              <li>
                {plan.captionStyles} caption styles
                {plan.brandColours ? " + brand colours" : ""}
              </li>
              <li>AI titles and hashtags: {plan.aiTitles ? "yes" : "no"}</li>
              <li>
                Auto-post to TikTok, Shorts, Reels, Facebook:{" "}
                {plan.autoPost ? `yes, ${plan.accountsPerPlatform} accounts each` : "no"}
              </li>
              <li>{plan.seats} team seat{plan.seats > 1 ? "s" : ""}</li>
            </ul>
          </article>
        ))}
      </section>
    </>
  );
}
