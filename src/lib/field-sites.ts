import type { Bounds } from './field-geometry';
export const fieldSites: {id:string;name:{ja:string;en:string};bbox:Bounds;source:string}[] = [
 {id:'brackenridge',name:{ja:'UT Brackenridge周辺（草地・河畔林）',en:'UT Brackenridge vicinity (prairie / riparian woodland)'},bbox:[-97.785,30.281,-97.775,30.289],source:'https://fieldstations.utexas.edu/field-stations'},
 {id:'hornsby',name:{ja:'Hornsby Bend周辺（水域・湿地）',en:'Hornsby Bend vicinity (ponds / wetlands)'},bbox:[-97.662,30.211,-97.648,30.223],source:'https://www.austintexas.gov/water/facilities'},
 {id:'manor',name:{ja:'Manor周辺（農地を探す範囲）',en:'Manor vicinity (agricultural study area)'},bbox:[-97.562,30.332,-97.548,30.344],source:'https://www.manortx.gov/'},
 {id:'uonuma',name:{ja:'魚沼周辺（比較用）',en:'Uonuma vicinity (reference)'},bbox:[138.95,37.222,138.964,37.234],source:'https://www.city.uonuma.lg.jp/'}
];
