/**
 * The 3R rule, in one place.
 *
 * Race, religion and royalty are quarantined: this project has no named human reviewer, so a subject
 * that touches them cannot be published automatically. The rule is used twice - by research to skip a
 * candidate before spending a writer call, and by qa-check to block a finished article. Two copies of
 * the same regex drift, so there is one.
 */
export const THREE_R = /\b(race|racial|racism|religion|religious|royalty|royal institution|sultan|sultans|agong|bumiputera|muslim|muslims|halal|vernacular school|evangelis(m|t|ing))\b/i;