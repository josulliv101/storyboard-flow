import os
import re
from PIL import Image

image_path = r"C:\Users\josul\.gemini\antigravity\brain\b2e1395d-c258-4431-a2ac-9cdccce88700\media__1780947242789.png"
img = Image.open(image_path)
width, height = img.size

# 1. Convert to binary mask
mask = []
for y in range(height):
    row = []
    for x in range(width):
        r, g, b, a = img.getpixel((x, y))
        luminance = 0.299 * r + 0.587 * g + 0.114 * b
        if a > 128 and luminance > 180:
            row.append(1)
        else:
            row.append(0)
    mask.append(row)

# Helper: Find connected components of a value (0 or 1)
def find_components(value):
    visited = [[False for _ in range(width)] for _ in range(height)]
    components = []
    for y in range(height):
        for x in range(width):
            if mask[y][x] == value and not visited[y][x]:
                comp = []
                queue = [(x, y)]
                visited[y][x] = True
                while queue:
                    cx, cy = queue.pop(0)
                    comp.append((cx, cy))
                    for dx in [-1, 0, 1]:
                        for dy in [-1, 0, 1]:
                            if dx == 0 and dy == 0:
                                continue
                            nx, ny = cx + dx, cy + dy
                            if 0 <= nx < width and 0 <= ny < height:
                                if mask[ny][nx] == value and not visited[ny][nx]:
                                    visited[ny][nx] = True
                                    queue.append((nx, ny))
                components.append(comp)
    return components

# Find white components (foreground)
fg_components = find_components(1)
print(f"Found {len(fg_components)} foreground components.")

# Find black components (background)
bg_components = find_components(0)
print(f"Found {len(bg_components)} background components.")

# Moore-Neighbor tracer
def trace_contour(pixels_list):
    pixels_set = set(pixels_list)
    if not pixels_list:
        return []
        
    # Find start pixel (top-left-most)
    start = min(pixels_list, key=lambda p: (p[1], p[0]))
    
    # Directions: 0=R, 1=UR, 2=U, 3=UL, 4=L, 5=DL, 6=D, 7=DR
    dirs = [(1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1)]
    
    contour = []
    curr = start
    prev_dir = 6 # search from bottom/left
    
    while True:
        contour.append(curr)
        found = False
        start_search = (prev_dir + 5) % 8
        for i in range(8):
            d_idx = (start_search + i) % 8
            dx, dy = dirs[d_idx]
            nx, ny = curr[0] + dx, curr[1] + dy
            if (nx, ny) in pixels_set:
                curr = (nx, ny)
                prev_dir = d_idx
                found = True
                break
        if not found or curr == start:
            break
        if len(contour) > len(pixels_list) * 2:
            print("Warning: contour trace loop limit exceeded.")
            break
    return contour

# Process each foreground component
final_paths = []
all_points = []

for f_idx, fg_comp in enumerate(fg_components):
    fg_set = set(fg_comp)
    # Trace outer boundary
    outer_boundary = trace_contour(fg_comp)
    all_points.extend(outer_boundary)
    print(f"Foreground {f_idx} outer boundary length: {len(outer_boundary)}")
    
    # Build path commands
    path_commands = []
    if outer_boundary:
        cmd = f"M {outer_boundary[0][0]} {outer_boundary[0][1]}"
        for pt in outer_boundary[1:]:
            cmd += f" L {pt[0]} {pt[1]}"
        cmd += " Z"
        path_commands.append(cmd)
        
    # Find holes inside this foreground component.
    # A background component is a hole if all its pixels are surrounded by this foreground component.
    # Practically, a background component is a hole if:
    # 1. It doesn't touch the border of the image.
    # 2. All its neighboring pixels that are NOT in the background component are in this foreground component.
    for b_idx, bg_comp in enumerate(bg_components):
        bg_set = set(bg_comp)
        
        # Check border
        touches_border = False
        for px, py in bg_comp:
            if px == 0 or px == width - 1 or py == 0 or py == height - 1:
                touches_border = True
                break
        if touches_border:
            continue
            
        # Check neighbors
        is_hole_for_this_fg = True
        for px, py in bg_comp:
            for dx in [-1, 0, 1]:
                for dy in [-1, 0, 1]:
                    nx, ny = px + dx, py + dy
                    if 0 <= nx < width and 0 <= ny < height:
                        if mask[ny][nx] == 1 and (nx, ny) not in fg_set:
                            # Neighbor is in a DIFFERENT foreground component
                            is_hole_for_this_fg = False
                            break
            if not is_hole_for_this_fg:
                break
                
        if is_hole_for_this_fg:
            # Found a hole! Trace its boundary.
            hole_boundary = trace_contour(bg_comp)
            all_points.extend(hole_boundary)
            print(f"  Found hole in Foreground {f_idx}! Boundary length: {len(hole_boundary)}")
            if hole_boundary:
                cmd = f"M {hole_boundary[0][0]} {hole_boundary[0][1]}"
                for pt in hole_boundary[1:]:
                    cmd += f" L {pt[0]} {pt[1]}"
                cmd += " Z"
                path_commands.append(cmd)
                
    # Combine outer boundary and holes for this component
    final_paths.append(" ".join(path_commands))

# Calculate cropped viewBox of all traced points
min_x = min(pt[0] for pt in all_points)
max_x = max(pt[0] for pt in all_points)
min_y = min(pt[1] for pt in all_points)
max_y = max(pt[1] for pt in all_points)

print(f"Bounding Box: X={min_x} to {max_x}, Y={min_y} to {max_y}")
w_box = max_x - min_x
h_box = max_y - min_y

padding = 4
v_x = min_x - padding
v_y = min_y - padding
v_w = w_box + padding * 2
v_h = h_box + padding * 2

print(f"Cropped viewBox: {v_x} {v_y} {v_w} {v_h}")

# Generate SVG content
svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{v_x} {v_y} {v_w} {v_h}" fill="currentColor" width="100%" height="100%">
"""
for p_idx, path_d in enumerate(final_paths):
    # Use fill-rule="evenodd" to correctly mask out the hole!
    svg_content += f'  <path d="{path_d}" fill-rule="evenodd" />\n'
svg_content += "</svg>\n"

# Save to public folder
dest_svg = r"c:\Users\josul\Documents\Projects\StoryboardAI\RemotionTimeline\apps\web\public\logo.svg"
with open(dest_svg, "w") as f:
    f.write(svg_content)
print(f"Saved optimized SVG to {dest_svg}")
