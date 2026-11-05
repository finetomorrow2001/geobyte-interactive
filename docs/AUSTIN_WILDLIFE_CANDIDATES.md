# Austin wildlife study candidates — 2026-11-05

Two candidates were selected for `/field` and `/imagery`. Boxes are screening extents chosen by Codex, **not surveyed property or damage boundaries**. No trap, animal or breeding-pond coordinates are provided. No owner contact was sent and no visit booked.

| Priority | Candidate | Basis | Box [west,south,east,north] | Appropriate use |
|---|---|---|---|---|
| 1 — agricultural | Farmshare Austin, Cedar Creek | Named farm with a historical hog-damage report; operator publishes current location | `[-97.515,30.194,-97.509,30.201]` | Obtain actual affected-field boundaries and observation dates before drawing agricultural conclusions |
| 2 — conservation / research | Griffith League Ranch, Bastrop County | Named ranch in a primary pond-disturbance study; Texas State lists research access | `[-97.27,30.20,-97.24,30.23]` | Recent vegetation/moisture screening; research partnership candidate, not a confirmed currently damaged crop farm |

## Farmshare Austin

[The Guardian, 2023-07-25](https://www.theguardian.com/food/2023/jul/25/us-wild-boar-invasive-species-food-menu) reports hog damage at Farmshare in 2022. This historical account does not establish present damage.

The [operator contact page](https://www.farmshareaustin.org/contact) gives 3608 River Road, Cedar Creek, TX 78612. Its public website configuration `businessLocationCoordinates` gives latitude 30.1974546, longitude -97.5119701; the box encloses that location. Raw extracted provenance is saved outside the repo at `output/sdl-ui-austin-20261105/research/farmshare-location.json`. A website business pin is not a survey of crop fields. [The operator’s 2026 careers page](https://www.farmshareaustin.org/administrative-manager) describes a 13-acre organic farm; do not confuse historical acreages or directory mailing addresses with boundaries. The operator says the farm is normally closed to the public except special events.

Use same-season dates in and around 2022 as an exploratory comparison, **not an automatic damage label**. Drought, irrigation, harvest and crop rotation are competing explanations. A small damaged patch can be smaller than a Sentinel-2 pixel. Request field photographs, dates, crop management and an authorized boundary if pursuing validation.

## Griffith League Ranch

[Brown, Jones, Bell & Forstner, Texas Journal of Science 64(2), 73–88](https://static1.squarespace.com/static/62c58fb8ec55834710187981/t/62c9a1530e5d6a4f92c96e67/1657381204650/Brown%2Bet%2Bal.%2B2012-%2BFeral%2Bhog%2Bdamage%2Bto%2Bendangered%2BHouston%2Btoad%2Bhabitat%2Bin%2Bthe%2BLost%2BPines%2Bof%2BTexas.pdf) documents hog disturbance around ponds, with 2011 observations. The issue is dated May 2012 and explicitly marked **published June 2015**; web crawl/upload dates are not publication or observation dates. The box is a rounded vicinity around the public study-site location [30.215390 N, -97.255320 W in published research](https://lacerta.eu/AF/Bibliografie/BIB_5425.pdf); it does not identify individual ponds or claim to cover the entire ranch.

[Texas State University’s field-site page](https://www.bio.txst.edu/about/facilities-and-field-sites.html) identifies forest, pasture and ponds and describes research/teaching access. It is **Texas State**, not UT Austin. Historical university and paper acreages differ, so neither is used as an official geometry. The 2011 event predates Sentinel-2; this application cannot reconstruct its before/after using Sentinel-2. Fire recovery and land management are important confounders ([2018 primary study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6308863/)).

## Regional evidence and rejected shortcuts

- [TSSWCB, 2022-08-03](https://tsswcb.texas.gov/news/feral-hog-control-resources-available-landowners-milam-and-williamson-counties): official USDA-linked control program in Williamson and Milam counties. Useful partner lead; not evidence that any randomly selected farm was damaged. No farm-specific box added from county-level evidence.
- [Austin Water official hog-management briefing](https://services.austintexas.gov/edims/document.cfm?id=352944): conservation context; not a named damaged crop farm.
- Existing Manor, Brackenridge and Hornsby examples remain exploratory/reference areas; no new damage claim.
- Austin **County** is not Austin city/Travis County. Hog-buying facilities, hunting businesses, hog presence and storm-damage reports do not establish crop damage.
- [Swerdfeger, 2023, East Texas A&M thesis](https://lair.etamu.edu/etd/1093/) provides UAV/ground-truth method context, not Austin farm coordinates. [USDA-affiliated Texas producer study](https://digitalcommons.unl.edu/icwdm_usdanwrc/2466/) provides impact categories, not a public list of identifiable Austin farms.

## Implementation and interpretation

Both pages consume the same `wildlifeSites` catalog, with identical coordinates and bilingual evidence caveats. Selecting an area deliberately resets analysis to avoid stale results; language selection must preserve the existing state. Existing resolution, sampling, reflectance correction, SCL policy and scientific calculations are unchanged. These indices show vegetation/moisture change, not animals, crop-loss dollars or proof of causation. User-supplied authorized GeoJSON is required for farm-specific analysis. No default dates, automatic search or scientific thresholds change when adding these options.
