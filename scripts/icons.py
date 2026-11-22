from PIL import Image, ImageDraw

for size in (192, 512):
    image = Image.new('RGB', (size, size), '#15352f')
    draw = ImageDraw.Draw(image)
    def scaled(points):
        return [(round(x * size / 100), round(y * size / 100)) for x, y in points]
    draw.polygon(scaled([(78,23),(61,77),(48,57),(25,47)]), fill='#d8f278')
    draw.line(scaled([(78,23),(48,57)]), fill='#81a043', width=max(2,size//70))
    image.save(f'public/icons/icon-{size}.png')
