# Triathlete model evidence register

Last reviewed: 2026-07-29

## Current decision

The calculation engine is `research-provisional`. It is suitable for
deterministic software testing, athlete-specific experimentation, and
coach-reviewed trend exploration. It is not approved for injury prediction,
diagnosis, or autonomous training prescription.

Athlete-data confidence and evidence maturity are separate:

- `estimated-default`, `partially-calibrated`, and `fully-calibrated` describe
  the completeness of athlete inputs and coefficient activation;
- `research-provisional` describes the scientific maturity of the formula
  itself.

No coefficient was changed in this review. Published values vary materially
with protocol, speed, stroke, athlete population, and measurement method, so a
single paper is not sufficient justification for silently replacing defaults.

## Primary evidence anchors

| Model area | Evidence anchor | Engineering implication |
|---|---|---|
| Critical swim velocity | Wakayoshi et al. (1992), DOI [10.1007/BF00717953](https://doi.org/10.1007/BF00717953) | Critical velocity is a defensible athlete input, but it must be measured per athlete rather than inferred from a population default for calibrated use. |
| Front-crawl energy cost | Zamparo et al. (2005), DOI [10.1007/s00421-004-1281-4](https://doi.org/10.1007/s00421-004-1281-4) | Energy cost changes with speed and technique; the current single swim cost constant remains a coarse prior. |
| Inter-limb coordination and swim cost | Seifert et al. (2014), DOI [10.1016/j.jsams.2013.07.003](https://doi.org/10.1016/j.jsams.2013.07.003) | A reported group mean must not be treated as a universal athlete coefficient. |
| ACWR in runners | Nakaoka et al. (2021), DOI [10.1007/s40279-021-01483-0](https://doi.org/10.1007/s40279-021-01483-0) | Associations vary by method and population; load ratios must not be labeled as injury-risk predictions. |
| ACWR “sweet spot” | Fanchini et al. (2020), PMID [32982781](https://pubmed.ncbi.nlm.nih.gov/32982781/) | Do not encode a universal safe-zone threshold or claim causal injury protection. |

## Acceptance criteria for external validation

The evidence maturity may change only after all of the following are complete:

1. Freeze a versioned protocol and intended population for each discipline.
2. Predefine outcomes, exclusion rules, missing-data handling, and acceptable
   error before examining validation results.
3. Compare predictions with held-out longitudinal athlete data; calibration
   data cannot also serve as validation data.
4. Report error distributions and calibration by discipline, sex, event
   distance, and athlete level where sample size permits.
5. Demonstrate test-retest reliability for athlete calibration protocols.
6. Review results with a qualified sport scientist and record approval scope.
7. Publish a new formula version; never relabel the existing version in place.

Until then, UI, exports, and ecosystem envelopes must retain the
`research-provisional` evidence label.
