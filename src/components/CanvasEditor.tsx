import { useEffect, useMemo, useState } from 'react';
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { nearestWall, snap } from '../lib/geometry';
import {
  heatmapToImageData,
  openingCenter,
  roomSignalsWithCalibration,
  signalLevel,
  SIGNAL_LEVEL_COLORS,
} from '../lib/heatmap';
import { usePlannerStore } from '../store/usePlannerStore';
import type { WallMaterial } from '../types/floorplan';

const MATERIAL_COLOR: Record<WallMaterial, string> = {
  concrete: '#2d3748',
  brick: '#3d4a5c',
  drywall: '#64748b',
  glass: '#7dd3fc',
};

const MATERIAL_WIDTH: Record<WallMaterial, number> = {
  concrete: 10,
  brick: 8,
  drywall: 5,
  glass: 3,
};

function RouterIcon({ label }: { label: string }) {
  return (
    <Group>
      <Circle radius={20} fill="rgba(22,119,255,0.15)" />
      <Circle radius={14} fill="#1677ff" shadowBlur={10} shadowColor="rgba(22,119,255,0.45)" />
      <Circle radius={4} fill="#fff" />
      <Line points={[-8, 2, 0, -10, 8, 2]} stroke="#fff" strokeWidth={2} lineCap="round" lineJoin="round" closed />
      <Text
        text={label}
        x={-30}
        y={18}
        width={60}
        align="center"
        fontSize={10}
        fill="#1677ff"
        fontFamily="Inter, sans-serif"
        fontStyle="bold"
      />
    </Group>
  );
}

export function CanvasEditor() {
  const {
    tool,
    plan,
    draftWallStart,
    activeStroke,
    sourceFloorPlanImage,
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
    clients,
    roomCalibrations,
    surveySamples,
    surveyActive,
    surveyMode,
    walkSurveyPoints,
    walkCapture,
    recordWalkSurveyPoint,
  } = usePlannerStore();

  const primaryAp = plan.aps[0] ?? null;
  const rooms = roomSignalsWithCalibration(plan, roomCalibrations);
  const calibratedIds = new Set(roomCalibrations.map((c) => c.roomId));
  const sampleCountByRoom = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of surveySamples) {
      counts.set(s.roomId, (counts.get(s.roomId) ?? 0) + 1);
    }
    return counts;
  }, [surveySamples]);

  const roomDeviceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of clients) {
      if (!c.suspectedRoomId) continue;
      counts.set(c.suspectedRoomId, (counts.get(c.suspectedRoomId) ?? 0) + 1);
    }
    return counts;
  }, [clients]);

  const [heatImage, setHeatImage] = useState<HTMLImageElement | null>(null);
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!sourceFloorPlanImage) {
      setSourceImage(null);
      return;
    }
    const image = new window.Image();
    image.onload = () => setSourceImage(image);
    image.src = sourceFloorPlanImage;
  }, [sourceFloorPlanImage]);

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

    if (surveyActive && surveyMode === 'walk') {
      recordWalkSurveyPoint(p);
      return;
    }

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
          <Rect width={canvasWidth} height={canvasHeight} fill="#ffffff" />
          {sourceImage ? (
            <KonvaImage
              image={sourceImage}
              width={canvasWidth}
              height={canvasHeight}
              opacity={0.48}
              listening={false}
            />
          ) : null}
        </Layer>

        <Layer listening={false}>
          {heatImage && showHeatmap ? (
            <KonvaImage image={heatImage} opacity={0.72} listening={false} />
          ) : null}
        </Layer>

        <Layer listening={false}>
          {primaryAp && clients.length
            ? clients.map((client) => {
                if (client.estimatedDistanceM == null) return null;
                const radius = client.estimatedDistanceM * plan.pixelsPerMeter;
                return (
                  <Circle
                    key={`ring-${client.mac}`}
                    x={primaryAp.x}
                    y={primaryAp.y}
                    radius={radius}
                    stroke="rgba(22,119,255,0.35)"
                    strokeWidth={1}
                    dash={[4, 8]}
                  />
                );
              })
            : null}
        </Layer>

        <Layer>
          {plan.strokes.map((s) => (
            <Line
              key={s.id}
              points={s.points}
              stroke="#94a3b8"
              strokeWidth={2}
              tension={0.3}
              lineCap="round"
              lineJoin="round"
              opacity={0.6}
            />
          ))}
          {activeStroke ? (
            <Line
              points={activeStroke}
              stroke="#1677ff"
              strokeWidth={2}
              tension={0.3}
              lineCap="round"
              lineJoin="round"
              opacity={0.8}
            />
          ) : null}

          {walkSurveyPoints.map((point, index) => {
            const color = SIGNAL_LEVEL_COLORS[signalLevel(point.signal)];
            return (
              <Group key={point.id} x={point.x} y={point.y} listening={false}>
                <Circle radius={13} fill="rgba(255,255,255,0.9)" stroke={color} strokeWidth={3} />
                <Circle radius={5} fill={color} />
                <Text
                  x={16}
                  y={-7}
                  text={`${index + 1} · ${point.signal.toFixed(0)} dBm`}
                  fontSize={11}
                  fontFamily="Inter, sans-serif"
                  fontStyle="bold"
                  fill={color}
                />
              </Group>
            );
          })}
          {walkCapture ? (
            <Group x={walkCapture.x} y={walkCapture.y} listening={false}>
              <Circle radius={16} stroke="#1677ff" strokeWidth={2} dash={[4, 4]} />
              <Text
                x={20}
                y={-7}
                text={`采集中 ${walkCapture.signals.length}/5`}
                fontSize={11}
                fontFamily="Inter, sans-serif"
                fontStyle="bold"
                fill="#1677ff"
              />
            </Group>
          ) : null}

          {plan.walls.map((w) => (
            <Group key={w.id}>
              <Line
                points={[w.a.x, w.a.y, w.b.x, w.b.y]}
                stroke="#fff"
                strokeWidth={MATERIAL_WIDTH[w.material] + 3}
                lineCap="square"
              />
              <Line
                points={[w.a.x, w.a.y, w.b.x, w.b.y]}
                stroke={MATERIAL_COLOR[w.material]}
                strokeWidth={MATERIAL_WIDTH[w.material]}
                lineCap="square"
              />
            </Group>
          ))}

          {draftWallStart ? (
            <Circle x={draftWallStart.x} y={draftWallStart.y} radius={4} fill="#1677ff" />
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
                stroke={o.kind === 'door' ? '#f8fafc' : '#bae6fd'}
                strokeWidth={o.kind === 'door' ? 12 : 6}
                lineCap="butt"
              />
            );
          })}

          {rooms.map((r) => {
            const planRoom = plan.rooms.find((pr) => pr.id === r.roomId);
            if (!planRoom) return null;
            const deviceCount = roomDeviceCounts.get(r.roomId) ?? 0;
            const calibrated = calibratedIds.has(r.roomId);
            const sampleCount = sampleCountByRoom.get(r.roomId) ?? 0;
            const color = SIGNAL_LEVEL_COLORS[r.level];
            const badgeW = Math.max(72, r.name.length * 14 + (calibrated ? 44 : 36));
            const badgeH = deviceCount > 0 || calibrated ? 40 : 28;
            return (
              <Group key={r.roomId} x={planRoom.x - badgeW / 2} y={planRoom.y - 14}>
                <Rect
                  width={badgeW}
                  height={badgeH}
                  fill="rgba(255,255,255,0.92)"
                  cornerRadius={8}
                  stroke={calibrated ? '#16a34a' : undefined}
                  strokeWidth={calibrated ? 1.5 : 0}
                  shadowBlur={6}
                  shadowColor="rgba(26,35,50,0.12)"
                  shadowOffsetY={2}
                />
                <Circle x={10} y={14} radius={4} fill={color} />
                <Text
                  x={18}
                  y={6}
                  text={r.name}
                  fontSize={12}
                  fontFamily="Inter, sans-serif"
                  fontStyle="bold"
                  fill="#1a2332"
                />
                <Text
                  x={18}
                  y={deviceCount > 0 || calibrated ? 20 : 14}
                  text={
                    r.measuredRssi != null
                      ? `${r.measuredRssi.toFixed(0)} dBm 实测`
                      : `${r.rssi.toFixed(0)} dBm`
                  }
                  fontSize={11}
                  fontFamily="Inter, sans-serif"
                  fill={r.measuredRssi != null && r.measuredRssi < -70 ? '#dc2626' : color}
                  fontStyle="bold"
                />
                {calibrated ? (
                  <Text
                    x={badgeW - 22}
                    y={6}
                    text="✓"
                    fontSize={12}
                    fill="#16a34a"
                    fontStyle="bold"
                  />
                ) : sampleCount > 0 ? (
                  <Text
                    x={badgeW - 28}
                    y={6}
                    text={`${sampleCount}`}
                    fontSize={10}
                    fill="#1677ff"
                    fontStyle="bold"
                  />
                ) : null}
                {deviceCount > 0 ? (
                  <Group x={badgeW - 16} y={8}>
                    <Circle radius={8} fill="#1677ff" />
                    <Text
                      x={-3}
                      y={-5}
                      text={String(deviceCount)}
                      fontSize={9}
                      fill="#fff"
                      fontFamily="Inter, sans-serif"
                      fontStyle="bold"
                    />
                  </Group>
                ) : null}
              </Group>
            );
          })}

          {plan.rooms
            .filter((r) => !rooms.some((rs) => rs.roomId === r.id))
            .map((r) => (
              <Group key={r.id} x={r.x - 28} y={r.y - 12}>
                <Rect width={56} height={24} fill="rgba(255,255,255,0.9)" cornerRadius={6} />
                <Text
                  x={8}
                  y={6}
                  text={r.name}
                  fontSize={12}
                  fontFamily="Inter, sans-serif"
                  fill="#64748b"
                />
              </Group>
            ))}

          {plan.aps.map((ap) => (
            <Group
              key={ap.id}
              x={ap.x}
              y={ap.y}
              draggable={tool === 'select' || tool === 'ap'}
              onDragEnd={(e) => moveAp(ap.id, e.target.x(), e.target.y())}
            >
              <RouterIcon label={ap.label} />
            </Group>
          ))}
        </Layer>
      </Stage>
    </div>
  );
}
