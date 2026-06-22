// ========================================
// SUN CONTROL (bottom-right overlay, below the control panel)
// ========================================
// Drives the scene's sun:
//   - Curved arc (semicircle) = the sun's daily path. The knob travels from the
//     LEFT horizon (dawn, 06:00) over the apex (noon, 12:00) to the RIGHT horizon
//     (sunset, 18:00). Its position (dayAngle) sets BOTH the time label and the
//     elevation (height on the arc).
//   - Straight slider = rotation (azimuth, 0..360).
//
// This is a controlled component: the parent owns `dayAngle` + `azimuth` state
// and the SkyOcean reads the resulting sun direction.

'use client'

import { useCallback, useRef } from 'react'

// Arc geometry (SVG user units). Sized so the knob + glow never clip at the
// apex (top), the horizons (sides), or below the baseline.
const W = 176
const H = 96
const CX = W / 2
const CY = 80
const R = 64
const KNOB_R = 8
const GLOW_R = KNOB_R + 5

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// dayAngle (0..180 deg along the arc) -> sun elevation (0..90 deg).
export function elevationFromDayAngle(dayAngle: number): number {
  return Math.sin((dayAngle * Math.PI) / 180) * 90
}

// dayAngle -> time of day. Left horizon (180) = 06:00, apex (90) = 12:00,
// right horizon (0) = 18:00.
export function timeFromDayAngle(dayAngle: number): number {
  return 18 - dayAngle / 15
}

// Sun world direction (unit vector) from the arc position + rotation.
// The sun travels along a vertical arc:
//   dayAngle 0   = right horizon  (sunset side),
//   dayAngle 90  = apex (straight up),
//   dayAngle 180 = left horizon   (dawn side) — the OPPOSITE compass direction
//                  to sunset, not just a lower sun at the same spot.
// `azimuthDeg` (0..360) rotates that whole arc around the vertical (Y) axis.
export function sunDirectionFromState(
  dayAngle: number,
  azimuthDeg: number,
): [number, number, number] {
  const a = (dayAngle * Math.PI) / 180
  const horizontal = Math.cos(a) // signed: + = sunset side, - = dawn side
  const height = Math.sin(a) // up (>= 0 across the daytime arc)
  const az = (azimuthDeg * Math.PI) / 180
  const x = horizontal * Math.sin(az)
  const z = horizontal * Math.cos(az)
  return [x, height, z]
}

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

// 12-hour clock, e.g. "4:30 pm" / "11:05 am".
function formatClock(hoursFloat: number): string {
  const totalMinutes = Math.round(hoursFloat * 60)
  const hours24 = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const period = hours24 >= 12 ? 'pm' : 'am'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${pad2(minutes)} ${period}`
}

function phaseFromTime(hoursFloat: number): { label: string; sub: string } {
  if (hoursFloat < 7.5) return { label: 'Dawn', sub: 'Golden hour' }
  if (hoursFloat < 11) return { label: 'Morning', sub: 'Daylight' }
  if (hoursFloat < 13) return { label: 'Midday', sub: 'Daylight' }
  if (hoursFloat < 16) return { label: 'Afternoon', sub: 'Daylight' }
  if (hoursFloat < 17.5) return { label: 'Evening', sub: 'Golden hour' }
  return { label: 'Sunset', sub: 'Golden hour' }
}

function cardGradient(elevation: number): string {
  if (elevation > 55) return 'linear-gradient(135deg, #6fb7f5 0%, #cfe9ff 100%)'
  if (elevation > 28) return 'linear-gradient(135deg, #8ec6f0 0%, #ffe6bf 100%)'
  if (elevation > 10) return 'linear-gradient(135deg, #f0a36a 0%, #ffd9a6 100%)'
  return 'linear-gradient(135deg, #e8794d 0%, #ffbf8c 100%)'
}

export default function SunControl({
  dayAngle,
  azimuth,
  onDayAngle,
  onAzimuth,
}: {
  dayAngle: number
  azimuth: number
  onDayAngle: (v: number) => void
  onAzimuth: (v: number) => void
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const draggingRef = useRef(false)

  const elevation = elevationFromDayAngle(dayAngle)
  const hoursFloat = timeFromDayAngle(dayAngle)

  // dayAngle (deg from right baseline) -> knob position on the arc.
  const a = (dayAngle * Math.PI) / 180
  const knobX = CX + R * Math.cos(a)
  const knobY = CY - R * Math.sin(a)

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      // Map client px into SVG user units (the SVG scales to its box).
      const px = ((clientX - rect.left) / rect.width) * W
      const py = ((clientY - rect.top) / rect.height) * H
      const ang = clamp(Math.atan2(CY - py, px - CX), 0, Math.PI)
      onDayAngle((ang * 180) / Math.PI)
    },
    [onDayAngle],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      draggingRef.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      updateFromPointer(e.clientX, e.clientY)
    },
    [updateFromPointer],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!draggingRef.current) return
      updateFromPointer(e.clientX, e.clientY)
    },
    [updateFromPointer],
  )

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    draggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  const phase = phaseFromTime(hoursFloat)

  return (
    <div
      data-no-snap
      className="absolute right-4 lg:right-12 bottom-8 z-30 w-[180px] select-none rounded-xl p-3 shadow-xl ring-1 ring-white/40"
      style={{ background: cardGradient(elevation), backdropFilter: 'blur(8px)' }}
    >
      <div className="flex items-start justify-between">
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white drop-shadow-sm">{phase.label}</div>
          <div className="text-[10px] font-medium text-white/80">{phase.sub}</div>
        </div>
        <div className="text-lg font-light tabular-nums text-white drop-shadow-sm">
          {formatClock(hoursFloat)}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 w-full cursor-pointer touch-none"
        style={{ height: H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Arc track (dawn -> noon -> sunset) */}
        <path
          d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
          fill="none"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth={6}
          strokeLinecap="round"
        />
        {/* Baseline (horizon) */}
        <line
          x1={CX - R}
          y1={CY}
          x2={CX + R}
          y2={CY}
          stroke="rgba(255,255,255,0.35)"
          strokeWidth={2}
          strokeLinecap="round"
        />
        {/* Knob glow */}
        <circle cx={knobX} cy={knobY} r={GLOW_R + 2} fill="rgba(255,244,214,0.45)" />
        <circle cx={knobX} cy={knobY} r={GLOW_R} fill="rgba(255,240,200,0.55)" />
        {/* Sun knob */}
        <circle cx={knobX} cy={knobY} r={KNOB_R} fill="#fff7e0" stroke="#ffd27a" strokeWidth={2} />
      </svg>

      <div className="mt-1.5">
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={Math.round(azimuth)}
          onChange={(e) => onAzimuth(Number(e.target.value))}
          aria-label="Sun rotation"
          className="sun-rotation-slider w-full"
        />
        <div className="mt-0.5 text-center text-[10px] font-medium text-white/85">Sun rotation</div>
      </div>

      <style jsx>{`
        .sun-rotation-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 5px;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.5);
          outline: none;
        }
        .sun-rotation-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 9999px;
          background: #fff7e0;
          border: 2px solid #ffd27a;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
          cursor: pointer;
        }
        .sun-rotation-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 9999px;
          background: #fff7e0;
          border: 2px solid #ffd27a;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
          cursor: pointer;
        }
      `}</style>
    </div>
  )
}
