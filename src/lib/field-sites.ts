import type { Bounds } from './field-geometry';
type Text = {ja:string;en:string};
export type FieldSite = {id:string;name:Text;bbox:Bounds;source:string;detail?:Text;sources?:{label:string;url:string}[]};

// Vicinity boxes, never cadastral boundaries or locations of traps / breeding ponds.
// Location provenance and screening limitations: docs/AUSTIN_WILDLIFE_CANDIDATES.md.
export const wildlifeSites: FieldSite[] = [
 {id:'farmshare',name:{ja:'Farmshare Austin周辺（農場・被害報道あり）',en:'Farmshare Austin vicinity (farm / reported damage)'},bbox:[-97.515,30.194,-97.509,30.201],source:'https://www.farmshareaustin.org/contact',
  detail:{ja:'2022年のイノシシ被害報道を手掛かりに調べる候補。農場公式サイトの所在地周辺で、被害区画の境界ではありません。干ばつ・灌漑・収穫も比較し、現地記録で確認してください。通常は一般公開されていません。',en:'Candidate prompted by a report of hog damage in 2022. The box surrounds the farm’s published location, not mapped damage parcels. Check drought, irrigation and harvest against field records. The farm is normally closed to the public.'},
  sources:[{label:'Farmshare Austin · location / access',url:'https://www.farmshareaustin.org/contact'},{label:'The Guardian · 2023-07-25',url:'https://www.theguardian.com/food/2023/jul/25/us-wild-boar-invasive-species-food-menu'}]},
 {id:'griffith',name:{ja:'Griffith League Ranch周辺（牧場・湿地の研究例）',en:'Griffith League Ranch vicinity (ranch / wetland study)'},bbox:[-97.27,30.20,-97.24,30.23],source:'https://www.bio.txst.edu/about/facilities-and-field-sites.html',
  detail:{ja:'イノシシによる池岸の攪乱を調べた論文の研究地周辺。2011年の記録はSentinel-2運用前で、当時の被害の前後比較はできません。近年の植生・水分変化の探索用で、火災・森林管理の影響や立入条件を別途確認してください。',en:'Vicinity of a published pond-disturbance study. Its 2011 observations predate Sentinel-2, so this viewer cannot provide a before/after comparison of that event. Screen recent vegetation and moisture changes; check fire, land management and access separately.'},
  sources:[{label:'Texas State University · field sites',url:'https://www.bio.txst.edu/about/facilities-and-field-sites.html'},{label:'Brown et al. · Texas Journal of Science 64(2), 73–88 (published 2015)',url:'https://static1.squarespace.com/static/62c58fb8ec55834710187981/t/62c9a1530e5d6a4f92c96e67/1657381204650/Brown%2Bet%2Bal.%2B2012-%2BFeral%2Bhog%2Bdamage%2Bto%2Bendangered%2BHouston%2Btoad%2Bhabitat%2Bin%2Bthe%2BLost%2BPines%2Bof%2BTexas.pdf'}]}
];
export const fieldSites: FieldSite[] = [
 {id:'brackenridge',name:{ja:'UT Brackenridge周辺（草地・河畔林）',en:'UT Brackenridge vicinity (prairie / riparian woodland)'},bbox:[-97.785,30.281,-97.775,30.289],source:'https://fieldstations.utexas.edu/field-stations'},
 {id:'hornsby',name:{ja:'Hornsby Bend周辺（水域・湿地）',en:'Hornsby Bend vicinity (ponds / wetlands)'},bbox:[-97.662,30.211,-97.648,30.223],source:'https://www.austintexas.gov/water/facilities'},
 {id:'manor',name:{ja:'Manor周辺（農地を探す範囲）',en:'Manor vicinity (agricultural study area)'},bbox:[-97.562,30.332,-97.548,30.344],source:'https://www.manortx.gov/'},
 {id:'uonuma',name:{ja:'魚沼周辺（比較用）',en:'Uonuma vicinity (reference)'},bbox:[138.95,37.222,138.964,37.234],source:'https://www.city.uonuma.lg.jp/'},
 ...wildlifeSites
];
