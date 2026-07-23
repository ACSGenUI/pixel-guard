export function clusterDiffRegions(diffMask, width, height, options) {
  const { cellSize, cellDiffThreshold, minClusterAreaPx } = options;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cellCounts = new Array(cols * rows).fill(0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (diffMask[y * width + x]) {
        const cellX = Math.floor(x / cellSize);
        const cellY = Math.floor(y / cellSize);
        cellCounts[cellY * cols + cellX] += 1;
      }
    }
  }

  const flagged = cellCounts.map((count) => count >= cellDiffThreshold);
  const visited = new Array(cols * rows).fill(false);
  const regions = [];

  for (let cellY = 0; cellY < rows; cellY += 1) {
    for (let cellX = 0; cellX < cols; cellX += 1) {
      const idx = cellY * cols + cellX;
      if (!flagged[idx] || visited[idx]) continue;

      const queue = [[cellX, cellY]];
      visited[idx] = true;
      let minCellX = cellX;
      let maxCellX = cellX;
      let minCellY = cellY;
      let maxCellY = cellY;
      let diffPixelCount = cellCounts[idx];

      while (queue.length > 0) {
        const [cx, cy] = queue.shift();
        const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          const nIdx = ny * cols + nx;
          if (!flagged[nIdx] || visited[nIdx]) continue;
          visited[nIdx] = true;
          queue.push([nx, ny]);
          minCellX = Math.min(minCellX, nx);
          maxCellX = Math.max(maxCellX, nx);
          minCellY = Math.min(minCellY, ny);
          maxCellY = Math.max(maxCellY, ny);
          diffPixelCount += cellCounts[nIdx];
        }
      }

      const x = minCellX * cellSize;
      const y = minCellY * cellSize;
      const regionWidth = Math.min((maxCellX + 1) * cellSize, width) - x;
      const regionHeight = Math.min((maxCellY + 1) * cellSize, height) - y;

      if (regionWidth * regionHeight >= minClusterAreaPx) {
        regions.push({
          x, y, width: regionWidth, height: regionHeight, diffPixelCount,
        });
      }
    }
  }

  return regions;
}
