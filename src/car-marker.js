export function drawCar(context) {
  context.fillStyle='#15352f';
  for (const x of [-12,8]) {
    context.fillRect(x,-10,4,7);
    context.fillRect(x,5,4,7);
  }
  context.beginPath();
  context.roundRect(-10,-16,20,32,7);
  context.fillStyle='#215dde';
  context.strokeStyle='#fff';
  context.lineWidth=2.5;
  context.stroke();
  context.fill();

  context.beginPath();
  context.roundRect(-6,-8,12,6,2);
  context.roundRect(-6,6,12,4,1.5);
  context.fillStyle='#c9e4ff';
  context.fill();

  context.fillStyle='#fff';
  context.fillRect(-6,-13,3,2);
  context.fillRect(3,-13,3,2);
}
