import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import Settings from "@/Core/Settings";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";

const auras = {
  flameShock: 188389,
  lavaSurge: 77762,
  masterOfTheElements: 260734,
};

export class ShamanElementalBehavior extends Behavior {
  name = "Shaman [Elemental]";
  context = BehaviorContext.Any;
  specialization = Specialization.Shaman.Elemental;

  static settings = [
    {
      header: "Elemental Shaman (Stormbringer)",
      options: [
        { uid: "UseStormkeeper", name: "Use Stormkeeper", type: "checkbox", default: true },
        { uid: "UseAscendance", name: "Use Ascendance", type: "checkbox", default: true },
      ]
    }
  ];

  get maelstromCap() {
    let cap = 100;
    if (spell.isSpellKnown("Swelling Maelstrom")) cap += 50;
    return cap;
  }

  get enemyCount() {
    return combat.targets.length;
  }

  get hasElementalBlast() {
    return spell.isSpellKnown("Elemental Blast");
  }

  get earthquakeThreshold() {
    return this.hasElementalBlast ? 5 : 2;
  }

  shouldSpend() {
    return me.power > this.maelstromCap - 15 || me.hasAura(auras.masterOfTheElements);
  }

  build() {
    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      common.waitForTarget(),
      common.waitForFacing(),
      spell.interrupt("Wind Shear", false),
      spell.cast("Spiritwalker's Grace", on => me, ret => me.isMoving() && combat.bestTarget),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          new bt.Decorator(
            ret => this.hasCooldownsReady(),
            this.burstCooldowns()
          ),
          new bt.Decorator(
            ret => this.enemyCount >= 3,
            this.aoeRotation()
          ),
          this.singleTargetRotation()
        )
      )
    );
  }

  hasCooldownsReady() {
    return combat.burstToggle && (
      (Settings.UseStormkeeper && spell.isSpellKnown("Stormkeeper") && !spell.isOnCooldown("Stormkeeper")) ||
      (Settings.UseAscendance && spell.isSpellKnown("Ascendance") && !spell.isOnCooldown("Ascendance"))
    );
  }

  burstCooldowns() {
    return new bt.Selector(
      spell.cast("Stormkeeper", on => me, ret => Settings.UseStormkeeper),
      spell.cast("Ancestral Swiftness", on => me),
      spell.cast("Ascendance", on => me, ret => {
        if (!Settings.UseAscendance) return false;
        if (me.hasAura("Stormkeeper")) return true;
        if (!spell.isSpellKnown("Stormkeeper")) return true;
        return spell.isOnCooldown("Stormkeeper");
      })
    );
  }

  singleTargetRotation() {
    return new bt.Selector(
      // Ascendance window: dump maelstrom before it fades
      spell.cast("Elemental Blast", on => me.target, ret => {
        if (!this.hasElementalBlast) return false;
        const asc = me.getAura("Ascendance");
        return asc && asc.remaining < 3000;
      }),
      spell.cast("Earth Shock", on => me.target, ret => {
        if (this.hasElementalBlast) return false;
        const asc = me.getAura("Ascendance");
        return asc && asc.remaining < 3000;
      }),

      // Ascendance window: refresh Voltaic Blaze before it fades
      spell.cast("Voltaic Blaze", on => me.target, ret => {
        const asc = me.getAura("Ascendance");
        return asc && asc.remaining < 3000;
      }),

      // Voltaic Blaze to refresh Flame Shock (pandemic <= 6s)
      spell.cast("Voltaic Blaze", on => me.target, ret => {
        if (!me.targetUnit) return false;
        const fs = me.targetUnit.getAuraByMe(auras.flameShock);
        return !fs || fs.remaining <= 6000;
      }),

      // Tempest proc (Stormbringer)
      spell.cast("Tempest", on => me.target, ret => me.hasAura("Tempest")),

      // Spender at maelstrom threshold or MotE
      spell.cast("Earthquake", on => me.target, ret => {
        return this.enemyCount >= this.earthquakeThreshold && this.shouldSpend();
      }),
      spell.cast("Elemental Blast", on => me.target, ret => {
        if (this.enemyCount >= this.earthquakeThreshold) return false;
        return this.hasElementalBlast && this.shouldSpend();
      }),
      spell.cast("Earth Shock", on => me.target, ret => {
        if (this.enemyCount >= this.earthquakeThreshold) return false;
        return !this.hasElementalBlast && this.shouldSpend();
      }),

      // Lava Burst when Flame Shock is up and MotE is not active
      spell.cast("Lava Burst", on => me.target, ret => {
        if (!me.targetUnit) return false;
        return me.targetUnit.hasAuraByMe(auras.flameShock) && !me.hasAura(auras.masterOfTheElements);
      }),

      // Flame Shock fallback when Voltaic Blaze is on CD
      spell.cast("Flame Shock", on => me.target, ret => {
        if (!me.targetUnit) return false;
        const fs = me.targetUnit.getAuraByMe(auras.flameShock);
        if (fs && fs.remaining > 5400) return false;
        if (!spell.isSpellKnown("Voltaic Blaze")) return true;
        return spell.isOnCooldown("Voltaic Blaze");
      }),

      // Filler: Stormkeeper + 2 targets still prefers Lightning Bolt
      spell.cast("Lightning Bolt", on => me.target, ret => {
        return this.enemyCount === 2 && me.hasAura("Stormkeeper");
      }),
      spell.cast("Chain Lightning", on => me.target, ret => this.enemyCount >= 2),
      spell.cast("Lightning Bolt", on => me.target)
    );
  }

  aoeRotation() {
    return new bt.Selector(
      // Voltaic Blaze on CD for FS spread + Purging Flames
      spell.cast("Voltaic Blaze", on => me.target),

      // Tempest proc (Stormbringer AoE priority)
      spell.cast("Tempest", on => me.target, ret => me.hasAura("Tempest")),

      // AoE spender
      spell.cast("Earthquake", on => me.target, ret => {
        return this.enemyCount >= this.earthquakeThreshold && this.shouldSpend();
      }),
      spell.cast("Elemental Blast", on => me.target, ret => {
        if (this.enemyCount >= this.earthquakeThreshold) return false;
        return this.hasElementalBlast && this.shouldSpend();
      }),
      spell.cast("Earth Shock", on => me.target, ret => {
        if (this.enemyCount >= this.earthquakeThreshold) return false;
        return !this.hasElementalBlast && this.shouldSpend();
      }),

      // Lava Burst on Lava Surge proc (consumes Purging Flames)
      spell.cast("Lava Burst", on => me.target, ret => {
        if (!me.targetUnit) return false;
        return me.hasAura(auras.lavaSurge) && me.targetUnit.hasAuraByMe(auras.flameShock);
      }),

      // Chain Lightning filler
      spell.cast("Chain Lightning", on => me.target)
    );
  }
}
