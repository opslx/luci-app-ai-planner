import { useEffect, useState } from 'react';
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { nearestWall, snap } from '../lib/geometry';
import { heatmapToImageData, openingCenter } from '../lib/heatmap';
import { usePlannerStore } from '../store/usePlannerStore';
import type { WallMaterial } from '../types/floorplan';

const MATERIAL_COLOR: Record<WallMaterial, string> = {
  concrete: '#1e293b',
  brick: '#334155',
  drywall: '#64748b',
  glass: '#38bdf8',
};

export function CanvasEditor() {
  const {
    tool,
    plan,
    draftWallStart,
    activeStroke,
    heatmap,
    showHeatmap,
    canvasWidth,
    canvasHeight,
    addWall,
    setDraftWallStart,
    addOpening,
    addAp,
    moveAp,
    addRoom,
    beginStroke,
    appendStroke,
    endStroke,
    eraseAt,
  } = usePlannerStore();

  const [heatImage, setHeatImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!heatmap || !showHeatmap) {
      setHeatImage(null);
      return;
    }
    const imageData = heatmapToImageData(heatmap);
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(imageData, 0, 0);
    const img = new window.Image();
    img.onload = () => setHeatImage(img);
    img.src = canvas.toDataURL();
  }, [heatmap, showHeatmap]);

  const onPointerDown = (e: { target: { getStage: () => { getPointerPosition: () => { x: number; y: number } | null } | null } }) => {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    const p = { x: snap(pos.x), y: snap(pos.y) };

    if (tool === 'wall') {
      if (!draftWallStart) setDraftWallStart(p);
      else addWall(draftWallStart, p);
      return;
    }
    if (tool === 'door' || tool === 'window') {
      const hit = nearestWall(plan.walls, p, 28);
      if (hit) addOpening(tool, hit.wall.id, hit.t);
      return;
    }
    if (tool === 'ap') {
      addAp(p.x, p.y);
      return;
    }
    if (tool === 'room') {
      const name = window.prompt('房间名称', '房间') || '房间';
      addRoom(p.x, p.y, name);
      return;
    }
    if (tool === 'draw') {
      beginStroke(pos.x, pos.y);
      return;
    }
    if (tool === 'eraser') {
      eraseAt(p.x, p.y);
    }
  };

  const onPointerMove = (e: { target: { getStage: () => { getPointerPosition: () => { x: number; y: number } | null } | null } }) => {
    if (tool !== 'draw' || !activeStroke) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    appendStroke(pos.x, pos.y);
  };

  const onPointerUp = () => {
    if (tool === 'draw') endStroke();
  };

  return (
    <div className="canvas-shell" id="floorplan-stage">
      <Stage
        width={canvasWidth}
        height={canvasHeight}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
      >
        <Layer listening={false}>
          <Rect width={canvasWidth} height={canvasHeight} fill="#f3f6f4" />
          {/* subtle grid */}
          {Array.from({ length: Math.floor(canvasWidth / 40) + 1 }).map((_, i) => (
            <Line
              key={`vx-${i}`}
              points={[i * 40, 0, i * 40, canvasHeight]}
              stroke="#d7e0db"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: Math.floor(canvasHeight / 40) + 1 }).map((_, i) => (
            <Line
              key={`hy-${i}`}
              points={[0, i * 40, canvasWidth, i * 40]}
              stroke="#d7e0db"
              strokeWidth={1}
            />
          ))}
        </Layer>

        <Layer listening={false}>
          {heatImage && showHeatmap ? (
            <KonvaImage image={heatImage} opacity={0.85} listening={false} />
          ) : null}
        </Layer>

        <Layer>
          {plan.strokes.map((s) => (
            <Line
              key={s.id}
              points={s.points}
              stroke={s.color}
              strokeWidth={3}
              tension={0.3}
              lineCap="round"
              lineJoin="round"
              opacity={0.75}
            />
          ))}
          {activeStroke ? (
            <Line
              points={activeStroke}
              stroke="#0f766e"
              strokeWidth={3}
              tension={0.3}
              lineCap="round"
              lineJoin="round"
              opacity={0.85}
            />
          ) : null}

          {plan.walls.map((w) => (
            <Line
              key={w.id}
              points={[w.a.x, w.a.y, w.b.x, w.b.y]}
              stroke={MATERIAL_COLOR[w.material]}
              strokeWidth={w.material === 'concrete' ? 8 : w.material === 'brick' ? 6 : 4}
              lineCap="round"
            />
          ))}

          {draftWallStart ? (
            <Circle x={draftWallStart.x} y={draftWallStart.y} radius={5} fill="#0f766e" />
          ) : null}

          {plan.openings.map((o) => {
            const wall = plan.walls.find((w) => w.id === o.wallId);
            if (!wall) return null;
            const c = openingCenter(wall, o);
            const ang = Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x);
            const hw = o.width / 2;
            const dx = Math.cos(ang) * hw;
            const dy = Math.sin(ang) * hw;
            return (
              <Line
                key={o.id}
                points={[c.x - dx, c.y - dy, c.x + dx, c.y + dy]}
                stroke={o.kind === 'door' ? '#b45309' : '#0284c7'}
                strokeWidth={o.kind === 'door' ? 10 : 8}
                lineCap="butt"
                opacity={0.95}
              />
            );
          })}

          {plan.rooms.map((r) => (
            <Text
              key={r.id}
              x={r.x - 28}
              y={r.y - 10}
              text={r.name}
              fontSize={16}
              fontFamily="Manrope, sans-serif"
              fill="#134e4a"
              fontStyle="bold"
            />
          ))}

          {plan.aps.map((ap) => (
            <Group
              key={ap.id}
              x={ap.x}
              y={ap.y}
              draggable={tool === 'select' || tool === 'ap'}
              onDragEnd={(e) => moveAp(ap.id, e.target.x(), e.target.y())}
            >
              <Circle radius={16} fill="#0f766e" shadowBlur={8} shadowColor="rgba(15,118,110,0.45)" />
              <Circle radius={6} fill="#ecfdf5" />
              <Text
                text={ap.label}
                x={-14}
                y={20}
                fontSize={12}
                fill="#134e4a"
                fontFamily="Manrope, sans-serif"
                fontStyle="bold"
              />
            </Group>
          ))}
        </Layer>
      </Stage>
    </div>
  );
}
