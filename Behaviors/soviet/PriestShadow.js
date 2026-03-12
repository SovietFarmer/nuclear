import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import spell from "@/Core/Spell";
import objMgr, { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Specialization from "@/Enums/Specialization";
import common from "@/Core/Common";
import Settings from "@/Core/Settings";
import { PowerType } from "@/Enums/PowerType";
import { RaceType } from "@/Enums/UnitEnums";

const auras = {
  shadowWordPain: 589,
  vampiricTouch: 34914,
  powerInfusion: 10060,
  powerWordShield: 17,
  shadowWordMadness: 335467,
  voidform: 194249,
  mindDevourer: 373202, // unverified — user doesn't have talent yet
  entropicRift: 450193,
};

export class PriestShadowVoidweaver extends Behavior {
  name = "Shadow Priest (Voidweaver) PVE";
  context = BehaviorContext.Any;
  specialization = Specialization.Priest.Shadow;
  static settings = [];

  build() {
    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      common.waitForTarget(),
      common.waitForFacing(),
      spell.interrupt("Silence"),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForCombat(),
          spell.cast("Power Word: Shield", on => me, ret => me.pctHealth <= 90 && !me.hasAuraByMe(auras.powerWordShield)),
          spell.cast("Desperate Prayer", on => me, ret => me.pctHealth <= 75),
          new bt.Decorator(
            ret => this.hasCooldownsReady(),
            this.burstCooldowns()
          ),
          new bt.Decorator(
            ret => this.getEnemyCount(10) > 2,
            this.aoeRotation()
          ),
          this.mainRotation()
        )
      )
    );
  }

  // --- Burst CDs (gated by burstToggle + hasCooldownsReady) ---

  burstCooldowns() {
    return new bt.Selector(
      this.useRacials(),
      this.useTrinkets(),
      // actions.cds: power_infusion,if=(buff.voidform.up|!talent.voidform)&!buff.power_infusion.up
      spell.cast("Power Infusion", on => me, ret =>
        (me.hasAura(auras.voidform) || !spell.isSpellKnown("Voidform")) &&
        !me.hasAura(auras.powerInfusion)
      ),
      // actions.cds: halo
      spell.cast("Halo", on => this.getCurrentTarget()),
      // actions.cds: voidform,if=active_dot.shadow_word_pain>=active_dot.vampiric_touch
      spell.cast("Voidform", on => me, ret => this.dotsUp()),
    );
  }

  useRacials() {
    return new bt.Selector(
      // Sync racials with Voidform + PI window or fight ending
      spell.cast("Fireblood", on => me, ret =>
        (me.hasAura(auras.voidform) || !spell.isSpellKnown("Voidform")) && me.hasAura(auras.powerInfusion)
      ),
      spell.cast("Berserking", on => me, ret =>
        me.race === RaceType.Troll &&
        (me.hasAura(auras.voidform) || !spell.isSpellKnown("Voidform")) && me.hasAura(auras.powerInfusion)
      ),
      spell.cast("Blood Fury", on => me, ret =>
        me.race === RaceType.Orc &&
        (me.hasAura(auras.voidform) || !spell.isSpellKnown("Voidform")) && me.hasAura(auras.powerInfusion)
      ),
      spell.cast("Ancestral Call", on => me, ret =>
        (me.hasAura(auras.voidform) || !spell.isSpellKnown("Voidform")) && me.hasAura(auras.powerInfusion)
      ),
    );
  }

  useTrinkets() {
    return new bt.Selector(
      common.useTrinkets(
        () => undefined,
        () => me.hasAura(auras.voidform) || me.hasAura(auras.powerInfusion) || me.hasAura(auras.entropicRift)
      ),
    );
  }

  // --- AoE rotation (>2 targets) ---

  aoeRotation() {
    return new bt.Selector(
      // Tentacle Slam to spread VT to up to 6 targets
      spell.cast("Tentacle Slam",
        on => this.getTentacleSlamTarget(),
        ret => spell.isSpellKnown("Tentacle Slam") && this.shouldTentacleSlamAoE()
      ),
      // Manual VT on targets missing it
      spell.cast("Vampiric Touch",
        on => this.getTargetMissingAura(auras.vampiricTouch),
        ret => !!this.getTargetMissingAura(auras.vampiricTouch) && !this.aoeDotsUp()
      ),
      // Manual SWP on targets missing it that already have VT
      spell.cast("Shadow Word: Pain",
        on => this.getTargetMissingSWP(),
        ret => !!this.getTargetMissingSWP()
      ),
      // Fall through to main rotation for damage priority
      this.mainRotation()
    );
  }

  // --- Main single-target rotation (SimC actions.main) ---

  mainRotation() {
    return new bt.Selector(
      // actions.main: shadow_word_death — force Devour Matter
      spell.cast("Shadow Word: Death", on => this.getCurrentTarget(), ret =>
        spell.isSpellKnown("Devour Matter") && me.hasAura("Devour Matter")
      ),

      // actions.main: shadow_word_madness — don't overcap Insanity, refresh expiring, Mind Devourer proc, Rift up
      spell.cast("Shadow Word: Madness", on => this.getSWMadnessTarget(), ret => this.shouldCastSWMadness()),

      // actions.main: void_volley
      spell.cast("Void Volley", on => this.getCurrentTarget(), ret => spell.isSpellKnown("Void Volley")),

      // actions.main: void_blast — during Entropic Rift
      spell.cast("Void Blast", on => this.getCurrentTarget(), ret => this.isEntropicRiftUp()),

      // actions.main: tentacle_slam — spread VT when refreshable
      spell.cast("Tentacle Slam",
        on => this.getTentacleSlamTarget(),
        ret => spell.isSpellKnown("Tentacle Slam") && this.shouldTentacleSlamST()
      ),

      // actions.main: void_torrent — when dots are up, spawns Entropic Rift
      spell.cast("Void Torrent", on => this.getCurrentTarget(), ret => this.dotsUp()),

      // actions.main: shadow_word_pain — refresh with Invoked Nightmare talent
      spell.cast("Shadow Word: Pain", on => this.getCurrentTarget(), ret =>
        spell.isSpellKnown("Invoked Nightmare") &&
        this.isDebuffRefreshable(auras.shadowWordPain, 4500) &&
        this.targetHasAura(auras.vampiricTouch)
      ),

      // actions.main: mind_blast — when no Mind Devourer proc (or not talented)
      spell.cast("Mind Blast", on => this.getCurrentTarget(), ret =>
        !me.hasAura(auras.mindDevourer) || !spell.isSpellKnown("Mind Devourer")
      ),

      // actions.main: mind_flay_insanity — when SW:Madness is active on target
      spell.cast("Mind Flay: Insanity", on => this.getCurrentTarget(), ret =>
        this.targetHasAura(auras.shadowWordMadness)
      ),

      // actions.main: vampiric_touch — refresh on targets living >12s, Tentacle Slam not imminent
      spell.cast("Vampiric Touch", on => this.getCurrentTarget(), ret =>
        this.isDebuffRefreshable(auras.vampiricTouch, 5400) &&
        (!spell.isSpellKnown("Tentacle Slam") || spell.isOnCooldown("Tentacle Slam"))
      ),

      // actions.main: shadow_word_death — with pet active (Inescapable Torment) or execute
      spell.cast("Shadow Word: Death", on => this.getSWDeathTarget(), ret =>
        this.isPetActive() && spell.isSpellKnown("Inescapable Torment") ||
        (this.getCurrentTarget()?.pctHealth ?? 100) < 20
      ),

      // actions.main: mind_flay — base filler (chain, interrupt at 2 ticks)
      spell.cast("Mind Flay", on => this.getCurrentTarget()),

      // Movement / low-priority fallbacks
      spell.cast("Tentacle Slam", on => this.getCurrentTarget(), ret =>
        me.isMoving() && spell.isSpellKnown("Tentacle Slam")
      ),
      spell.cast("Shadow Word: Death", on => this.getCurrentTarget(), ret => me.isMoving()),
      spell.cast("Shadow Word: Pain", on => this.getCurrentTarget(), ret => me.isMoving()),
    );
  }

  // --- Helper methods ---

  getCurrentTarget() {
    const targetPredicate = unit =>
      common.validTarget(unit) && me.isFacing(unit) && me.distanceTo2D(unit) <= 40;
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  getInsanity() {
    return me.powerByType(PowerType.Insanity);
  }

  getInsanityDeficit() {
    return 100 - this.getInsanity();
  }

  getEnemyCount(range) {
    const target = this.getCurrentTarget();
    return target ? target.getUnitsAroundCount(range) : 0;
  }

  dotsUp() {
    const target = this.getCurrentTarget();
    if (!target) return false;
    return target.hasAuraByMe(auras.vampiricTouch) && target.hasAuraByMe(auras.shadowWordPain);
  }

  aoeDotsUp() {
    const maxVTs = Math.min(combat.targets.length, 12);
    const vtCount = combat.targets.filter(u => u.hasAuraByMe(auras.vampiricTouch)).length;
    const swpCount = combat.targets.filter(u => u.hasAuraByMe(auras.shadowWordPain)).length;
    return vtCount >= maxVTs && swpCount >= vtCount;
  }

  hasCooldownsReady() {
    return combat.burstToggle && (
      !spell.isOnCooldown("Voidform") ||
      !spell.isOnCooldown("Power Infusion") ||
      (spell.isSpellKnown("Halo") && !spell.isOnCooldown("Halo"))
    );
  }

  isEntropicRiftUp() {
    return me.hasAura(auras.entropicRift);
  }

  isPetActive() {
    if (!objMgr || !objMgr.objects) return false;
    for (const [, obj] of objMgr.objects) {
      if (obj instanceof wow.CGUnit &&
          obj.createdBy && me.guid &&
          obj.createdBy.equals(me.guid) &&
          (obj.name === "Mindbender" || obj.name === "Shadowfiend" || obj.name === "Voidwraith")) {
        return true;
      }
    }
    return false;
  }

  isDebuffRefreshable(auraId, pandemicWindow) {
    const target = this.getCurrentTarget();
    if (!target) return false;
    const debuff = target.getAuraByMe(auraId);
    if (!debuff) return true;
    return debuff.remaining <= pandemicWindow;
  }

  targetHasAura(auraId) {
    const target = this.getCurrentTarget();
    return target ? target.hasAuraByMe(auraId) : false;
  }

  // SW:Madness target selection — prefer target with most remaining time on the debuff for refreshes
  getSWMadnessTarget() {
    const target = this.getCurrentTarget();
    if (!target) return null;
    return target;
  }

  shouldCastSWMadness() {
    const target = this.getCurrentTarget();
    if (!target) return false;

    const insanityDeficit = this.getInsanityDeficit();
    const hasMD = me.hasAura(auras.mindDevourer);
    const debuff = target.getAuraByMe(auras.shadowWordMadness);
    const debuffRemaining = debuff ? debuff.remaining : 0;
    const riftUp = this.isEntropicRiftUp();

    // Don't overcap Insanity
    if (insanityDeficit <= 35) return true;
    // Refresh when expiring
    if (debuffRemaining > 0 && debuffRemaining <= 1500) return true;
    // Mind Devourer proc — free cast
    if (hasMD) return true;
    // During Entropic Rift — keep spending
    if (riftUp) return true;
    // No debuff active and we have enough Insanity
    if (!debuff && this.getInsanity() >= 50) return true;

    return false;
  }

  getSWDeathTarget() {
    const target = this.getCurrentTarget();
    if (!target) return null;
    // Prefer lowest HP target from combat list for execute
    const executeTarget = combat.targets.find(u =>
      u.pctHealth < 20 && common.validTarget(u) && me.isFacing(u) && me.distanceTo2D(u) <= 40
    );
    return executeTarget || target;
  }

  getTentacleSlamTarget() {
    // Target with lowest remaining VT for spreading
    const target = this.getCurrentTarget();
    if (!target) return null;
    let best = null;
    let lowestVT = Infinity;
    for (const unit of combat.targets) {
      if (!common.validTarget(unit) || me.distanceTo2D(unit) > 40) continue;
      const vt = unit.getAuraByMe(auras.vampiricTouch);
      const remaining = vt ? vt.remaining : 0;
      if (remaining < lowestVT) {
        lowestVT = remaining;
        best = unit;
      }
    }
    return best || target;
  }

  shouldTentacleSlamST() {
    const target = this.getCurrentTarget();
    if (!target) return false;
    const vt = target.getAuraByMe(auras.vampiricTouch);
    const vtRefreshable = !vt || vt.remaining <= 5400;
    // Cast if VT is refreshable or talented into Void Apparitions / Maddening Tentacles
    return vtRefreshable ||
      spell.isSpellKnown("Void Apparitions") ||
      spell.isSpellKnown("Maddening Tentacles");
  }

  shouldTentacleSlamAoE() {
    const vtCount = combat.targets.filter(u => u.hasAuraByMe(auras.vampiricTouch)).length;
    const maxVTs = Math.min(combat.targets.length, 12);
    return vtCount < maxVTs;
  }

  getTargetMissingAura(auraId) {
    return combat.targets.find(u =>
      common.validTarget(u) &&
      me.distanceTo2D(u) <= 40 &&
      me.isFacing(u) &&
      !u.hasAuraByMe(auraId)
    ) || null;
  }

  getTargetMissingSWP() {
    return combat.targets.find(u =>
      common.validTarget(u) &&
      me.distanceTo2D(u) <= 40 &&
      me.isFacing(u) &&
      u.hasAuraByMe(auras.vampiricTouch) &&
      !u.hasAuraByMe(auras.shadowWordPain)
    ) || null;
  }
}
