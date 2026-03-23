/**
 * network-bg.js — 3D Node Network Background
 *
 * ページ背景に「3D 空間を浮遊するノードネットワーク」を描画します。
 * 一番上の CONFIG オブジェクトを変更することで挙動をカスタマイズできます。
 *
 * カラーは現サイトのテーマカラーに合わせています。
 *   メイン  : #00d4ff (シアン)
 *   アクセント: #00ff88 (グリーン)
 *   背景    : #060a0f (ダークネイビー)
 */

const NetworkBG = (() => {

    /* ================================================================
       CONFIG — ここを変更してカスタマイズ
       ================================================================ */
    const CONFIG = {

        // ── ノード数 ────────────────────────────────────────────────────
        nodeCount: 80,    // 通常時のノード数
        mobileNodeCount: 45,    // 画面幅 768px 未満の場合のノード数

        // ── 接続 ────────────────────────────────────────────────────────
        maxDist: 150,   // 2D 投影後の接続距離閾値 [px]
        // 大きくすると線が増え密になる

        // ── ノード外観 ──────────────────────────────────────────────────
        nodeRadius: 2.2,   // ノードの基本半径 [px]
        accentRatio: 0.12,  // アクセントカラー (#00ff88) ノードの割合 [0–1]
        glowMultiplier: 4.0,   // グロー半径 = nodeRadius × glowMultiplier

        // ── 動き ────────────────────────────────────────────────────────
        speed: 0.40,  // 移動速度スケール（大きくすると速い）

        // ── 3D 設定 ─────────────────────────────────────────────────────
        fov: 500,   // 透視投影の焦点距離
        // 大きいほど奥行き感が弱まり、小さいほど強まる
        depthRange: 300,   // Z 軸の幅 — ノードは ±depthRange/2 の範囲で動く

        // ── 色 (rgba() に使う "r,g,b" 文字列) ──────────────────────────
        mainColor: '0,212,255',    // メインカラー   #00d4ff
        accentColor: '0,255,136',    // アクセントカラー #00ff88
        bgColor: '6,10,15',      // 背景色         #060a0f

        // ── パフォーマンス ──────────────────────────────────────────────
        fps: 60,    // フレームレート上限
    };

    /* ================================================================
       内部変数
       ================================================================ */
    let canvas, ctx, nodes, W, H, animId, lastTs = 0;
    const ftInterval = 1000 / CONFIG.fps;
    const rand = (a, b) => Math.random() * (b - a) + a;

    /* ================================================================
       Node クラス
       ================================================================ */
    class Node {
        constructor() {
            this.isAccent = Math.random() < CONFIG.accentRatio;
            this._init();
        }

        _init() {
            const hD = CONFIG.depthRange / 2;
            this.x = rand(-W / 2, W / 2);
            this.y = rand(-H / 2, H / 2);
            this.z = rand(-hD, hD);
            const s = CONFIG.speed;
            this.vx = rand(-s, s);
            this.vy = rand(-s, s);
            this.vz = rand(-s * 0.6, s * 0.6);
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;
            this.z += this.vz;
            // 境界でバウンス (画面端より少し余裕を持たせる)
            const hW = W / 2 + 60, hH = H / 2 + 60, hD = CONFIG.depthRange / 2;
            if (this.x < -hW || this.x > hW) this.vx *= -1;
            if (this.y < -hH || this.y > hH) this.vy *= -1;
            if (this.z < -hD || this.z > hD) this.vz *= -1;
        }

        /**
         * 透視投影: 3D → 2D スクリーン座標
         *   z 大 (正) → 遠い → scale 小 (縮小)
         *   z 小 (負) → 近い → scale 大 (拡大)
         */
        project() {
            const denom = CONFIG.fov + this.z;
            const scale = denom > 1 ? CONFIG.fov / denom : 0.001;
            return {
                sx: this.x * scale + W / 2,
                sy: this.y * scale + H / 2,
                scale: Math.min(scale, 2.5),
            };
        }
    }

    /* ================================================================
       初期化・リサイズ
       ================================================================ */
    function createNodes() {
        const count = W < 768 ? CONFIG.mobileNodeCount : CONFIG.nodeCount;
        nodes = Array.from({ length: count }, () => new Node());
    }

    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
        createNodes(); // サイズ変更時にノードを再生成
    }

    /* ================================================================
       描画
       ================================================================ */
    function draw() {
        // 背景をクリア
        ctx.fillStyle = `rgb(${CONFIG.bgColor})`;
        ctx.fillRect(0, 0, W, H);

        // 投影後の座標を計算し、Z でソート (遠い順に描画 = Painter's Algorithm)
        const pts = nodes.map(n => ({ n, ...n.project() }));
        pts.sort((a, b) => b.n.z - a.n.z);   // z 降順 = 遠いノードを先に描く

        const maxD2 = CONFIG.maxDist * CONFIG.maxDist;

        // ── エッジ描画 ─────────────────────────────────────────────────
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i];
            for (let j = i + 1; j < pts.length; j++) {
                const b = pts[j];
                const dx = a.sx - b.sx;
                const dy = a.sy - b.sy;
                const d2 = dx * dx + dy * dy;
                if (d2 > maxD2) continue;

                const distFade = 1 - Math.sqrt(d2) / CONFIG.maxDist;
                const depthAvg = (a.scale + b.scale) * 0.5;
                const alpha = (distFade * depthAvg * 0.50).toFixed(3);
                // 両端がアクセントノードならグリーン、それ以外はシアン
                const col = (a.n.isAccent && b.n.isAccent)
                    ? CONFIG.accentColor : CONFIG.mainColor;

                ctx.beginPath();
                ctx.moveTo(a.sx, a.sy);
                ctx.lineTo(b.sx, b.sy);
                ctx.strokeStyle = `rgba(${col},${alpha})`;
                ctx.lineWidth = depthAvg * 0.8;
                ctx.stroke();
            }
        }

        // ── ノード描画 ─────────────────────────────────────────────────
        for (const p of pts) {
            if (p.scale < 0.05) continue;
            const r = CONFIG.nodeRadius * p.scale;
            const col = p.n.isAccent ? CONFIG.accentColor : CONFIG.mainColor;
            const coreAlpha = Math.min(0.95, 0.35 + 0.65 * p.scale);

            // グロー (遠すぎるノードはスキップしてコスト削減)
            if (p.scale > 0.45) {
                const glR = r * CONFIG.glowMultiplier;
                const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, glR);
                g.addColorStop(0, `rgba(${col},${(0.18 * p.scale).toFixed(3)})`);
                g.addColorStop(1, `rgba(${col},0)`);
                ctx.beginPath();
                ctx.arc(p.sx, p.sy, glR, 0, Math.PI * 2);
                ctx.fillStyle = g;
                ctx.fill();
            }

            // コア (塗りつぶし円)
            ctx.beginPath();
            ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${col},${coreAlpha.toFixed(3)})`;
            ctx.fill();
        }
    }

    /* ================================================================
       アニメーションループ
       ================================================================ */
    function loop(ts) {
        animId = requestAnimationFrame(loop);
        const dt = ts - lastTs;
        if (dt < ftInterval) return;  // フレームレート制限
        lastTs = ts - (dt % ftInterval);
        for (const n of nodes) n.update();
        draw();
    }

    /* ================================================================
       公開エントリポイント
       ================================================================ */
    function init() {
        canvas = document.getElementById('bg-canvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');

        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
        window.addEventListener('resize', resize);
        createNodes();

        // prefers-reduced-motion が有効な場合は静的1フレームのみ描画
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            draw();
            return;
        }

        animId = requestAnimationFrame(loop);
    }

    // CONFIG を外部から参照・変更できるように公開
    return { init, CONFIG };

})();

document.addEventListener('DOMContentLoaded', NetworkBG.init);
