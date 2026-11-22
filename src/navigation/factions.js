const colors = {
  CV:['#b92c34','#e944493e'],TCP:['#12644b','#12a27544'],ADA:['#986e00','#dcb32945'],
  MIL:['#166183','#1e96c74d'],LJ:['#1355ad','#3477d946'],MNI:['#7a438a','#9e5fbd47'],NEU:['#596762','#afb9b345']
};

export function factionColors(feature) {
  return colors[feature.properties?.faction] ?? ['#9c554b','#d47e6850'];
}

export function areaName(feature) {
  const {label,faction}=feature.properties ?? {};
  return [label,faction].filter(Boolean).join(' · ');
}
