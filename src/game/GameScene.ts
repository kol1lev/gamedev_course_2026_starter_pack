import Phaser from 'phaser';

const PLAYER_SIZE = 44;
const PLAYER_SPEED = 260;
const PLAYER_MAX_HP = 3;
/** Высота верхней подписи: ниже неё игрок и мобы не появляются. */
const HUD_HEIGHT = 110;

const BULLET_SPEED = 520;
const BULLET_RADIUS = 5;
const BULLET_LIFETIME_MS = 1200;
const FIRE_COOLDOWN_MS = 200;

const START_DAMAGE = 1;
const HIT_FLASH_MS = 60;

const ENEMY_SPAWN_MS = 1400;
const EDGE_MARGIN = 24;
/** Хитбокс меньше картинки: попадания должны прощаться. */
const ENEMY_HITBOX_RATIO = 0.85;
/** Полоска HP: ширина — доля от размера моба. */
const HEALTH_BAR = { widthRatio: 0.9, height: 4, gap: 6 };

/** Мобы: чем больше HP, тем медленнее и дороже. */
const ENEMY_KINDS: readonly EnemyKind[] = [
  { key: 'enemy_fast', hp: 1, speed: 130, size: 28, score: 10, spikes: 6, color: '#fbbf24', stroke: '#92400e' },
  { key: 'enemy_mid', hp: 3, speed: 90, size: 36, score: 20, spikes: 8, color: '#ef4444', stroke: '#7f1d1d' },
  { key: 'enemy_tank', hp: 7, speed: 55, size: 46, score: 40, spikes: 10, color: '#a855f7', stroke: '#4c1d95' },
];

/** Цена любого улучшения в магазине после поражения. */
const UPGRADE_COST = 500;

const APPLE_SIZE = 34;
const APPLE_HEAL = 1;
const APPLE_PICKUP_DISTANCE = 42;

const FONT = 'system-ui, sans-serif';

const TEX_PLAYER = 'player';
const TEX_APPLE = 'apple';
/** Текстуры рисуем в 2 раза больше, чтобы они не мылились при масштабировании. */
const TEXTURE_SCALE = 2;

/** Значения, которые переживают рестарт сцены. */
const KEY_SCORE = 'score';
const KEY_MAX_HP = 'maxHp';
const KEY_DAMAGE = 'damage';

type Bullet = {
  sprite: Phaser.GameObjects.Arc;
  vx: number;
  vy: number;
  bornAt: number;
};

type EnemyKind = {
  key: string;
  hp: number;
  speed: number;
  size: number;
  score: number;
  spikes: number;
  color: string;
  stroke: string;
};

type Enemy = {
  sprite: Phaser.GameObjects.Image;
  hpBar: Phaser.GameObjects.Graphics;
  kind: EnemyKind;
  hp: number;
};

/**
 * Минимальная рабочая сцена курса.
 *
 * Игрок двигается, отстреливает мобов, которые появляются на краях карты,
 * собирает яблоки (восстанавливают HP), а после поражения тратит очки
 * на улучшения: максимум HP или урон.
 */
export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image;
  private apple!: Phaser.GameObjects.Image;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private hpUpgradeKey!: Phaser.Input.Keyboard.Key;
  private damageUpgradeKey!: Phaser.Input.Keyboard.Key;
  private scoreText!: Phaser.GameObjects.Text;
  private hpText!: Phaser.GameObjects.Text;
  private gameOverText!: Phaser.GameObjects.Text;
  private shopText!: Phaser.GameObjects.Text;
  private bullets: Bullet[] = [];
  private enemies: Enemy[] = [];
  private score = 0;
  private hp = PLAYER_MAX_HP;
  private maxHp = PLAYER_MAX_HP;
  private damage = START_DAMAGE;
  private lastShotAt = 0;
  private isGameOver = false;

  constructor() {
    super('GameScene');
  }

  /** Вызывается и при первом запуске, и после scene.restart(). */
  init(): void {
    if (this.registry.has(KEY_MAX_HP)) return;

    this.registry.set(KEY_MAX_HP, PLAYER_MAX_HP);
    this.registry.set(KEY_DAMAGE, START_DAMAGE);
    this.registry.set(KEY_SCORE, 0);
  }

  create(): void {
    const { width, height } = this.scale;

    this.bullets = [];
    this.enemies = [];
    this.readUpgrades();
    this.score = this.registry.get(KEY_SCORE) as number;
    this.hp = this.maxHp;
    this.lastShotAt = 0;
    this.isGameOver = false;

    this.createTextures();

    this.add
      .text(width / 2, 28, 'GAME DEV STARTER', {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0);

    this.add
      .text(
        width / 2,
        68,
        'Стрелки / WASD — движение. Мышь — прицел. ЛКМ или Space — стрельба. Яблоко лечит.',
        {
          fontFamily: FONT,
          fontSize: '18px',
          color: '#cbd5e1',
        },
      )
      .setOrigin(0.5, 0);

    this.player = this.makeSprite(TEX_PLAYER, width / 2, height / 2, PLAYER_SIZE);
    this.apple = this.makeSprite(TEX_APPLE, width * 0.72, height * 0.52, APPLE_SIZE);

    this.scoreText = this.add.text(24, height - 48, `Score: ${this.score}`, {
      fontFamily: FONT,
      fontSize: '22px',
      color: '#ffffff',
    });

    this.hpText = this.add
      .text(width - 24, height - 48, '', {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#ffffff',
      })
      .setOrigin(1, 0);

    this.gameOverText = this.add
      .text(width / 2, height / 2 - 80, '', {
        fontFamily: FONT,
        fontSize: '30px',
        color: '#f87171',
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false);

    this.shopText = this.add
      .text(width / 2, height / 2 + 10, '', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#e2e8f0',
        align: 'center',
        lineSpacing: 8,
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false);

    this.refreshHud();

    if (!this.input.keyboard) {
      throw new Error('Keyboard input is unavailable.');
    }

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
    this.restartKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.hpUpgradeKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
    this.damageUpgradeKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO);

    this.time.addEvent({
      delay: ENEMY_SPAWN_MS,
      loop: true,
      callback: this.spawnEnemy,
      callbackScope: this,
    });
  }

  /**
   * Текстуры рисуются кодом (canvas 2D), поэтому ассеты не нужны.
   * TextureManager живёт между рестартами сцены, поэтому ключи проверяем.
   */
  private createTextures(): void {
    this.createTexture(TEX_PLAYER, PLAYER_SIZE, drawPlayer);
    this.createTexture(TEX_APPLE, APPLE_SIZE, drawApple);

    for (const kind of ENEMY_KINDS) {
      this.createTexture(kind.key, kind.size, (ctx, s) => drawEnemy(ctx, s, kind));
    }
  }

  private createTexture(
    key: string,
    size: number,
    draw: (ctx: CanvasRenderingContext2D, s: number) => void,
  ): void {
    if (this.textures.exists(key)) return;

    const canvasTexture = this.textures.createCanvas(
      key,
      size * TEXTURE_SCALE,
      size * TEXTURE_SCALE,
    );
    if (!canvasTexture) return;

    const ctx = canvasTexture.context;
    ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE);
    draw(ctx, size);
    canvasTexture.refresh();
  }

  /** Спрайт нужного размера: текстура нарисована с запасом TEXTURE_SCALE. */
  private makeSprite(key: string, x: number, y: number, size: number): Phaser.GameObjects.Image {
    return this.add.image(x, y, key).setDisplaySize(size, size);
  }

  update(_time: number, delta: number): void {
    const seconds = delta / 1000;

    if (this.isGameOver) {
      this.handleShop();
      return;
    }

    this.movePlayer(seconds);
    this.keepPlayerOnScreen();
    this.handleShooting();
    this.updateBullets(seconds);
    this.updateEnemies(seconds);
    this.checkApple();
  }

  /**
   * Магазин после поражения: 1 — максимум HP, 2 — урон, R — новая попытка.
   * Очки — общая валюта, поэтому не сгорают при рестарте.
   */
  private handleShop(): void {
    if (Phaser.Input.Keyboard.JustDown(this.hpUpgradeKey)) {
      this.buyUpgrade(KEY_MAX_HP);
    }
    if (Phaser.Input.Keyboard.JustDown(this.damageUpgradeKey)) {
      this.buyUpgrade(KEY_DAMAGE);
    }
    if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
      this.scene.restart();
    }
  }

  /** Покупка: списываем очки, поднимаем значение в registry, обновляем экран. */
  private buyUpgrade(registryKey: string): void {
    if (this.score < UPGRADE_COST) {
      const { width, height } = this.scale;
      this.showPopup(width / 2, height / 2 + 80, 'Не хватает очков', '#f87171');
      return;
    }

    this.score -= UPGRADE_COST;
    this.registry.set(KEY_SCORE, this.score);
    this.registry.inc(registryKey);
    this.readUpgrades();
    this.refreshHud();
    this.refreshShop();
  }

  /** Купленные улучшения живут в registry, поэтому читаем их оттуда. */
  private readUpgrades(): void {
    this.maxHp = this.registry.get(KEY_MAX_HP) as number;
    this.damage = this.registry.get(KEY_DAMAGE) as number;
  }

  private refreshHud(): void {
    this.scoreText.setText(`Score: ${this.score}`);
    this.hpText.setText(`HP: ${this.hp}/${this.maxHp}  Урон: ${this.damage}`);
  }

  private refreshShop(): void {
    this.gameOverText.setText(`Игра окончена. Очки: ${this.score}`);
    this.shopText.setText([
      `1 — максимум HP (+1) за ${UPGRADE_COST}, сейчас ${this.maxHp}`,
      `2 — урон (+1) за ${UPGRADE_COST}, сейчас ${this.damage}`,
      'R — заново',
    ]);
  }

  private movePlayer(seconds: number): void {
    let dx = 0;
    let dy = 0;

    if (this.cursors.left.isDown || this.wasd.left.isDown) dx -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) dx += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) dy -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) dy += 1;

    if (dx !== 0 || dy !== 0) {
      const length = Math.hypot(dx, dy);
      this.player.x += (dx / length) * PLAYER_SPEED * seconds;
      this.player.y += (dy / length) * PLAYER_SPEED * seconds;
    }
  }

  private keepPlayerOnScreen(): void {
    const half = this.player.displayWidth / 2;
    this.player.x = Phaser.Math.Clamp(this.player.x, half, this.scale.width - half);
    this.player.y = Phaser.Math.Clamp(this.player.y, HUD_HEIGHT + half, this.scale.height - half);
  }

  private handleShooting(): void {
    const isPointerDown = Boolean(this.input.activePointer?.isDown);

    if (!isPointerDown && !this.cursors.space.isDown) return;
    if (this.time.now - this.lastShotAt < FIRE_COOLDOWN_MS) return;

    this.lastShotAt = this.time.now;
    this.spawnBullet();
  }

  private spawnBullet(): void {
    const angle = this.getAimAngle();
    const sprite = this.add.circle(this.player.x, this.player.y, BULLET_RADIUS, 0xf8fafc);

    this.bullets.push({
      sprite,
      vx: Math.cos(angle) * BULLET_SPEED,
      vy: Math.sin(angle) * BULLET_SPEED,
      bornAt: this.time.now,
    });
  }

  /** Угол от игрока к курсору мыши. */
  private getAimAngle(): number {
    const pointer = this.input.activePointer;
    const camera = this.cameras.main;

    if (pointer) {
      pointer.updateWorldPoint(camera);
      return Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.worldX, pointer.worldY);
    }

    return 0;
  }

  private updateBullets(seconds: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.bullets[i];
      bullet.sprite.x += bullet.vx * seconds;
      bullet.sprite.y += bullet.vy * seconds;

      if (this.isBulletDead(bullet)) {
        this.destroyBullet(i);
        continue;
      }

      const enemy = this.findEnemyHitBy(bullet.sprite);
      if (!enemy) continue;

      this.hitEnemy(enemy);
      this.destroyBullet(i);
    }
  }

  private destroyBullet(index: number): void {
    this.bullets[index].sprite.destroy();
    this.bullets.splice(index, 1);
  }

  private isBulletDead(bullet: Bullet): boolean {
    if (this.time.now - bullet.bornAt > BULLET_LIFETIME_MS) return true;

    const { sprite } = bullet;
    return (
      sprite.x < -BULLET_RADIUS ||
      sprite.x > this.scale.width + BULLET_RADIUS ||
      sprite.y < -BULLET_RADIUS ||
      sprite.y > this.scale.height + BULLET_RADIUS
    );
  }

  private updateEnemies(seconds: number): void {
    const playerHalf = this.player.displayWidth / 2;

    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      const angle = Phaser.Math.Angle.Between(
        enemy.sprite.x,
        enemy.sprite.y,
        this.player.x,
        this.player.y,
      );

      enemy.sprite.x += Math.cos(angle) * enemy.kind.speed * seconds;
      enemy.sprite.y += Math.sin(angle) * enemy.kind.speed * seconds;
      this.drawHealthBar(enemy);

      const distance = Phaser.Math.Distance.Between(
        enemy.sprite.x,
        enemy.sprite.y,
        this.player.x,
        this.player.y,
      );

      if (distance > this.hitRadius(enemy) + playerHalf) continue;

      this.removeEnemy(enemy);
      this.loseHp();
    }
  }

  /** Моб любого типа появляется с случайного края; тип выбираем случайно. */
  private spawnEnemy(): void {
    if (this.isGameOver) return;

    const kind = ENEMY_KINDS[Phaser.Math.Between(0, ENEMY_KINDS.length - 1)];
    const point = this.getRandomEdgePoint();
    const enemy: Enemy = {
      sprite: this.makeSprite(kind.key, point.x, point.y, kind.size),
      hpBar: this.add.graphics(),
      kind,
      hp: kind.hp,
    };

    this.enemies.push(enemy);
    this.drawHealthBar(enemy);
  }

  /** Случайная точка на краю поля, но ниже подписи. */
  private getRandomEdgePoint(): { x: number; y: number } {
    const left = EDGE_MARGIN;
    const right = this.scale.width - EDGE_MARGIN;
    const top = HUD_HEIGHT + EDGE_MARGIN;
    const bottom = this.scale.height - EDGE_MARGIN;
    const side = Phaser.Math.Between(0, 3);

    if (side === 0) {
      return { x: Phaser.Math.Between(left, right), y: top };
    }
    if (side === 1) {
      return { x: right, y: Phaser.Math.Between(top, bottom) };
    }
    if (side === 2) {
      return { x: Phaser.Math.Between(left, right), y: bottom };
    }
    return { x: left, y: Phaser.Math.Between(top, bottom) };
  }

  /** Хитбокс моба: пропорционален его размеру. */
  private hitRadius(enemy: Enemy): number {
    return (enemy.kind.size / 2) * ENEMY_HITBOX_RATIO;
  }

  private findEnemyHitBy(bullet: Phaser.GameObjects.Arc): Enemy | undefined {
    return this.enemies.find((enemy) => {
      const distance = Phaser.Math.Distance.Between(
        bullet.x,
        bullet.y,
        enemy.sprite.x,
        enemy.sprite.y,
      );
      return distance <= this.hitRadius(enemy) + BULLET_RADIUS;
    });
  }

  /** Пуля снимает this.damage HP; если не убило — моб коротко вспыхивает. */
  private hitEnemy(enemy: Enemy): void {
    enemy.hp -= this.damage;

    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
      return;
    }

    this.drawHealthBar(enemy);
    enemy.sprite.setTint(0xffffff);
    this.time.delayedCall(HIT_FLASH_MS, () => {
      if (enemy.sprite.active) enemy.sprite.clearTint();
    });
  }

  private killEnemy(enemy: Enemy): void {
    const { x, y } = enemy.sprite;

    this.removeEnemy(enemy);

    this.score += enemy.kind.score;
    this.registry.set(KEY_SCORE, this.score);
    this.refreshHud();
    this.showPopup(x, y, `+${enemy.kind.score}`, '#facc15');
  }

  private removeEnemy(enemy: Enemy): void {
    enemy.sprite.destroy();
    enemy.hpBar.destroy();
    this.enemies.splice(this.enemies.indexOf(enemy), 1);
  }

  /** Полоска HP над мобом: тёмный фон + зелёная заправка по остатку HP. */
  private drawHealthBar(enemy: Enemy): void {
    const ratio = Phaser.Math.Clamp(enemy.hp / enemy.kind.hp, 0, 1);
    const width = enemy.kind.size * HEALTH_BAR.widthRatio;
    const x = enemy.sprite.x - width / 2;
    const y = enemy.sprite.y - enemy.sprite.displayHeight / 2 - HEALTH_BAR.gap;

    enemy.hpBar.clear();
    enemy.hpBar.fillStyle(0x1e293b);
    enemy.hpBar.fillRect(x, y, width, HEALTH_BAR.height);
    enemy.hpBar.fillStyle(0x4ade80);
    enemy.hpBar.fillRect(x, y, width * ratio, HEALTH_BAR.height);
  }

  private showPopup(x: number, y: number, label: string, color: string): void {
    const popup = this.add
      .text(x, y, label, {
        fontFamily: FONT,
        fontSize: '18px',
        color,
      })
      .setOrigin(0.5);

    this.tweens.add({
      targets: popup,
      y: y - 28,
      alpha: 0,
      duration: 500,
      onComplete: () => popup.destroy(),
    });
  }

  private loseHp(): void {
    this.hp -= 1;
    this.refreshHud();

    if (this.hp > 0) return;

    this.isGameOver = true;
    this.refreshShop();
    this.gameOverText.setVisible(true);
    this.shopText.setVisible(true);
  }

  /** Яблоко лечит APPLE_HEAL HP и появляется в новом месте. */
  private checkApple(): void {
    const distance = Phaser.Math.Distance.Between(
      this.player.x,
      this.player.y,
      this.apple.x,
      this.apple.y,
    );

    if (distance > APPLE_PICKUP_DISTANCE) return;

    const healed = Math.min(APPLE_HEAL, this.maxHp - this.hp);
    this.hp += healed;
    this.refreshHud();
    this.showPopup(
      this.apple.x,
      this.apple.y,
      healed > 0 ? `+${healed} HP` : 'HP полная',
      healed > 0 ? '#4ade80' : '#94a3b8',
    );

    this.apple.setPosition(
      Phaser.Math.Between(60, this.scale.width - 60),
      Phaser.Math.Between(HUD_HEIGHT + 30, this.scale.height - 80),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Процедурные текстуры: рисуем на canvas 2D, ассеты не нужны.        */
/* ------------------------------------------------------------------ */

function drawPlayer(ctx: CanvasRenderingContext2D, s: number): void {
  const c = s / 2;

  // корпус
  pathRoundRect(ctx, 3, 3, s - 6, s - 6, s * 0.2);
  ctx.fillStyle = '#38bdf8';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#075985';
  ctx.stroke();

  // глаза
  ctx.fillStyle = '#0f172a';
  pathCircle(ctx, c - s * 0.16, c - s * 0.08, s * 0.09);
  ctx.fill();
  pathCircle(ctx, c + s * 0.16, c - s * 0.08, s * 0.09);
  ctx.fill();

  // «визор»
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(c, c + s * 0.06, s * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

/** Общий вид моба: колючий корпус, число лучей и цвет берутся из типа. */
function drawEnemy(ctx: CanvasRenderingContext2D, s: number, kind: EnemyKind): void {
  const c = s / 2;
  const outer = c - 2;
  const inner = c - s * 0.24;
  const spikes = kind.spikes;

  // колючий корпус
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / spikes - Math.PI / 2;
    const x = c + Math.cos(angle) * radius;
    const y = c + Math.sin(angle) * radius;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fillStyle = kind.color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = kind.stroke;
  ctx.stroke();

  // «броневая» середина: у тяжёлых мобов она заметнее
  ctx.fillStyle = kind.stroke;
  pathCircle(ctx, c, c + s * 0.02, inner * 0.45);
  ctx.fill();

  // глаза
  ctx.fillStyle = '#fef2f2';
  pathCircle(ctx, c - s * 0.14, c - s * 0.04, s * 0.1);
  ctx.fill();
  pathCircle(ctx, c + s * 0.14, c - s * 0.04, s * 0.1);
  ctx.fill();

  ctx.fillStyle = '#0f172a';
  pathCircle(ctx, c - s * 0.12, c, s * 0.05);
  ctx.fill();
  pathCircle(ctx, c + s * 0.16, c, s * 0.05);
  ctx.fill();
}

function drawApple(ctx: CanvasRenderingContext2D, s: number): void {
  const cx = s / 2;
  const cy = s * 0.58;
  const r = s * 0.3;

  // черенок
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#7c4a03';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r + 2);
  ctx.quadraticCurveTo(cx + s * 0.04, cy - r - s * 0.12, cx + s * 0.1, cy - r - s * 0.18);
  ctx.stroke();

  // лист
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.17, cy - r - s * 0.1, s * 0.13, s * 0.07, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // тело яблока: три перекрывающихся круга
  ctx.fillStyle = '#dc2626';
  pathCircle(ctx, cx - s * 0.12, cy, r);
  ctx.fill();
  pathCircle(ctx, cx + s * 0.12, cy, r);
  ctx.fill();
  pathCircle(ctx, cx, cy - s * 0.05, r);
  ctx.fill();

  // блик
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.13, cy - s * 0.1, s * 0.06, s * 0.09, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

function pathRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function pathCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}
