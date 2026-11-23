export function drawCar(context,color='#2362de') {
  // Paint the side and front faces first so the car reads at map-marker size.
  context.lineJoin='round';
  context.beginPath();
  context.moveTo(-13,0);
  context.lineTo(-5,-10);
  context.lineTo(9,-9);
  context.lineTo(14,-2);
  context.lineTo(14,5);
  context.lineTo(6,11);
  context.lineTo(-13,6);
  context.closePath();
  context.fillStyle=color;
  context.fill();
  context.lineWidth=2.5;
  context.strokeStyle='#fff';
  context.stroke();

  context.beginPath();
  context.moveTo(-12,1);
  context.lineTo(6,5);
  context.lineTo(13,-1);
  context.lineTo(13,4);
  context.lineTo(6,9);
  context.lineTo(-12,5);
  context.closePath();
  context.fillStyle='#13294d';
  context.fill();

  context.beginPath();
  context.moveTo(-8,-2);
  context.lineTo(-4,-8);
  context.lineTo(6,-7);
  context.lineTo(2,-1);
  context.closePath();
  context.fillStyle='#d1f2fa';
  context.fill();

  context.beginPath();
  context.moveTo(3,-1);
  context.lineTo(7,-7);
  context.lineTo(11,-3);
  context.lineTo(7,1);
  context.closePath();
  context.fillStyle='#6eb8d1';
  context.fill();

  context.fillStyle='#fff6cf';
  context.fillRect(-10,2,3,1.7);
  context.fillRect(1,4.5,3,1.7);
}