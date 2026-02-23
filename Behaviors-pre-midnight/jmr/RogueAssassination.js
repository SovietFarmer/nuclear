import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { drawNgonAroundTarget } from '@/Extra/DrawingUtils';

export class RogueAssassinationNewBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Rogue.Assassination;
  name = "Jmr SimC Rogue Assassination";

  constructor() {
    super();
    this.lastDrawTime = 0;
    this.drawInterval = 1;
    this.MELEE_RANGE = 5;
    this.AOE_RANGE = 10;
    this.MAX_COMBO_POINTS = 5;
  }

  build() {
    return new bt.Selector(
      new bt.Action(() => {
        this.drawTargetNgon();
        return bt.Status.Running;
      }),
      common.waitForCastOrChannel(),
      common.waitForNotMounted(),
      this.applyPoisons(),
      this.stealthOpener(),
      common.waitForTarget(),
      this.interrupt(),
      this.defensives(),
      this.handleStealthedActions(),
      this.maintainSliceAndDice(),
      this.cooldowns(),
      this.coreDot(),
      new bt.Decorator(
        () => this.getEnemiesInRange(10).length > 1,
        this.aoeDoT()
      ),
      this.directDamage(),
      this.racials(),
      this.energyPooling()
    );
  }

  applyPoisons() {
    return new bt.Selector(
      spell.cast("Deadly Poison", on => me, () => !me.hasVisibleAura("Deadly Poison")),
      spell.cast("Atrophic Poison", on => me, () => !me.hasVisibleAura("Atrophic Poison")),
      spell.cast("Amplifying Poison", on => me, () => !me.hasVisibleAura("Amplifying Poison") && me.hasVisibleAura("Deadly Poison") && me.hasAura("Dragon-Tempered Blades")),
      spell.cast("Numbing Poison", on => me, () => !me.hasVisibleAura("Numbing Poison") && (me.hasVisibleAura("Atrophic Poison") || !me.hasAura("Atrophic Poison")) && me.hasAura("Dragon-Tempered Blades")),
      spell.cast("Crippling Poison", on => me, () => !me.hasVisibleAura("Crippling Poison") && (me.hasVisibleAura("Atrophic Poison") || !me.hasAura("Atrophic Poison")) && me.hasAura("Dragon-Tempered Blades"))
    );
  }

  stealthOpener() {
    return new bt.Selector(
      spell.cast("Stealth", on => me, () => !me.hasVisibleAura("Stealth") && !me.isMounted && !me.InCombat),
      spell.cast("Slice and Dice", on => me, () => !me.hasVisibleAura("Stealth") && !me.hasVisibleAura("Slice and Dice") && !me.InCombat && this.getEnemiesInRange(20) >= 1)
    );
  }

  interrupt() {
    return new bt.Selector(
      spell.interrupt("Kick", false),
      spell.interrupt("Cheap Shot", false),
      spell.interrupt("Kidney Shot", false)
    );
  }

  defensives() {
    return spell.cast("Crimson Vial", () => me.pctHealth < 70);
  }

  handleStealthedActions() {
    return new bt.Decorator(
      () => Boolean(this.getCurrentTarget().InCombat && (me.hasVisibleAura("Stealth") || me.hasVisibleAura("Improved Garrote") || me.hasVisibleAura("Master Assassin") || me.hasVisibleAura("Subterfuge"))),
      this.stealthedRotation(),
      new bt.Action(() => bt.Status.Success)
    );
  }

  stealthedRotation() {
    return new bt.Selector(
      spell.cast("Ambush", on => this.getCurrentTarget(), req => !this.getCurrentTarget().hasAuraByMe("Deathstalker's Mark") && this.hasTalent("Deathstalker's Mark")),
      spell.cast("Shiv", on => this.getCurrentTarget(), req => this.hasTalent("Kingsbane") && (this.getCurrentTarget().hasAuraByMe("Kingsbane") || spell.getCooldown("Kingsbane").timeleft === 0) && (!this.getCurrentTarget().hasAuraByMe("Shiv") && this.getDebuffRemainingTime("Shiv") < 1) && me.hasAura("Envenom")),
      spell.cast("Envenom", on => this.getCurrentTarget(), req => this.getEffectiveComboPoints() >= 4 && this.getDebuffRemainingTime("Kingsbane") > 0 && me.hasAura("Envenom") && (this.getCurrentTarget().hasAuraByMe("Deathstalker's Mark") || me.hasAura("Edge Case") || me.hasAura("Cold Blood"))),
      spell.cast("Rupture", on => this.getCurrentTarget(), req => this.getEffectiveComboPoints() >= 4 && me.hasAura("Indiscriminate Carnage") && this.getDebuffRemainingTime("Rupture") < 5 && (me.powerByType(PowerType.Energy) < 50 || this.getEffectiveComboPoints() < 4 || !this.getCurrentTarget().hasAuraByMe("Rupture")) && this.getTargetTimeToDie() > 15),
      spell.cast("Garrote", on => this.getCurrentTarget(), req => me.hasVisibleAura("Improved Garrote") && (this.getDebuffRemainingTime("Garrote") < 12 || (!this.singleTarget && me.hasVisibleAura("Master Assassin") && this.getAuraRemainingTime("Master Assassin") < 3)) && this.getEffectiveComboPoints() >= 1 + 2 * this.hasTalent("Shrouded Suffocation"))
    );
  }

  maintainSliceAndDice() {
    return new bt.Selector(
      spell.cast("Slice and Dice", on => me, req => !me.hasVisibleAura("Slice and Dice")),
      spell.cast("Envenom", on => this.getCurrentTarget(), req => me.hasAura("Slice and Dice") && this.getAuraRemainingTime("Slice and Dice") < 5 && this.getEffectiveComboPoints() >= 5)
    );
  }

  cooldowns() {
    return new bt.Selector(
      spell.cast("Deathmark", on => this.getCurrentTarget(), req => this.shouldUseDeathmark() && this.getCurrentTarget().timeToDeath() >= 10),
      this.useShiv(),
      spell.cast("Kingsbane", on => this.getCurrentTarget(), req => (this.getCurrentTarget().hasAuraByMe("Shiv") || spell.getCooldown("Shiv").remaining < 6) && me.hasAura("Envenom") && (spell.getCooldown("Deathmark").remaining >= 50 || this.getCurrentTarget().hasAuraByMe("Deathmark")) || this.getTargetTimeToDie() <= 15),
      spell.cast("Thistle Tea", on => me, req => !me.hasVisibleAura("Thistle Tea") && (((me.powerByType(PowerType.Energy) <= 100 || me.powerByType(PowerType.Energy) >= 100 && me.powerByType(PowerType.Energy) <= 150) && this.getDebuffRemainingTime("Shiv") >= 4) || this.getEnemiesInRange(10) >= 4 && this.getDebuffRemainingTime("Shiv") >= 6) || this.getTargetTimeToDie() < spell.getCharges("Thistle Tea") * 6),
      this.useMiscCooldowns(),
      this.useVanish(),
      spell.cast("Cold Blood", on => me, req => !me.hasAura("Edge Case") && spell.getCooldown("Deathmark").remaining > 10 && !me.hasAura("Darkest Night") && this.getEffectiveComboPoints() >= 4 && (me.getAuraStacks("Amplifying Poison") >= 20 || this.singleTarget) && !me.hasAura("Vanish") && (!spell.getCooldown("Kingsbane").ready || this.singleTarget) && !spell.getCooldown("Deathmark").ready)
    );
  }

  coreDot() {
    return new bt.Selector(
      spell.cast("Garrote", on => this.getCurrentTarget(), req => this.isRefreshable("Garrote") && this.getCurrentTarget().timeToDeath() > 12),
      spell.cast("Rupture", on => this.getCurrentTarget(), req => this.getEffectiveComboPoints() >= 4 && this.isRefreshable("Rupture") && this.getCurrentTarget().timeToDeath() - this.getDebuffRemainingTime("Rupture", this.getCurrentTarget()) > (4 + (me.hasAura("Dashing Scoundrel") ? 5 : 0) + (me.powerByType(PowerType.Energy) >= 50 ? 6 : 0)) && !me.hasAura("Darkest Night")),
      spell.cast("Crimson Tempest", on => this.getCurrentTarget(), req => this.getEffectiveComboPoints() >= 4 && this.isRefreshable("Crimson Tempest") && me.hasAura("Momentum of Despair") > 6 && this.singleTarget)
    );
  }

  aoeDoT() {
    const validTargets = this.getValidTargets();
    
    return new bt.Selector(
      new bt.Decorator(
        () => validTargets.length >= 2 && this.dotFinisherCondition && this.isRefreshable("Crimson Tempest"),
        spell.cast("Crimson Tempest", on => validTargets.find(target => 
          this.getPmultiplier("Crimson Tempest", target) <= 1 && 
          target.timeToDeath() - this.getDebuffRemainingTime("Crimson Tempest", target) > 6
        ))
      ),
      new bt.Decorator(
        () => this.comboPointsDeficit >= 1 && this.isRefreshable("Garrote") && !this.regenSaturated,
        spell.cast("Garrote", on => validTargets.find(target => 
          this.getPmultiplier("Garrote", target) <= 1 && 
          target.timeToDeath() - this.getDebuffRemainingTime("Garrote", target) > 12
        ))
      ),
      new bt.Decorator(
        () => this.dotFinisherCondition && this.isRefreshable("Rupture") && 
              (!this.regenSaturated && (this.hasTalent("Scent of Blood") === 2 || this.hasTalent("Scent of Blood") <= 1 && 
              (me.hasAura("Indiscriminate Carnage") || this.getTargetTimeToDie() > 15))) && 
              !me.hasAura("Darkest Night"),
        spell.cast("Rupture", on => validTargets.find(target => 
          this.getPmultiplier("Rupture", target) <= 1 && 
          (!target.hasAuraByMe("Kingsbane") || me.hasAura("Cold Blood")) &&
          target.timeToDeath() - this.getDebuffRemainingTime("Rupture", target) > (7 + (this.hasTalent("Dashing Scoundrel") ? 5 : 0) + (this.regenSaturated ? 6 : 0))
        ))
      )
    );
  }

  directDamage() {
    return new bt.Selector(
      spell.cast("Envenom", on => this.getCurrentTarget(), req => 
        !me.hasAura("Darkest Night") && 
        this.envenomFinisherCondition &&
        (this.notPooling || 
         this.getCurrentTarget().hasAuraByMe("Amplifying Poison").stacks >= 20 || 
         this.getEffectiveComboPoints() > this.getComboPointsMaxSpend() || 
         !this.singleTarget) && 
        !me.hasAura("Vanish")
      ),
      spell.cast("Envenom", on => this.getCurrentTarget(), req => 
        me.hasAura("Darkest Night") && 
        this.getEffectiveComboPoints() >= this.getComboPointsMaxSpend()
      ),
      spell.cast("Mutilate", on => this.getCurrentTarget(), req => this.useCausticFiller),
      spell.cast("Ambush", on => this.getCurrentTarget(), req => this.useCausticFiller),
      spell.cast("Echoing Reprimand", on => this.getCurrentTarget(), req => 
        this.useFiller || this.getTargetTimeToDie() < 20
      ),
      spell.cast("Fan of Knives", on => this.getCurrentTarget(), req => 
        this.useFiller && 
        !this.priorityRotation && 
        (this.getEnemiesInRange(10) >= (3 - (this.hasTalent("Momentum of Despair") && this.hasTalent("Thrown Precision") ? 1 : 0)) || 
         (me.hasAura("Clear the Witnesses") && !this.hasTalent("Vicious Venoms")))
      ),
      spell.cast("Ambush", on => this.getCurrentTarget(), req => 
        this.useFiller && 
        (me.hasAura("Blindside") || me.hasAura("Stealth")) && 
        (!this.getCurrentTarget().hasAuraByMe("Kingsbane") || 
         !this.getCurrentTarget().hasAuraByMe("Deathmark") || 
         me.hasAura("Blindside"))
      ),
      spell.cast("Mutilate", on => this.getCurrentTarget(), req => this.useFiller)
    );
  }

racials() {
    return new bt.Selector(
      spell.cast("Blood Fury", on => this.getCurrentTarget(), req => this.getCurrentTarget().hasAuraByMe("Deathmark")),
      spell.cast("Berserking", on => this.getCurrentTarget(), req => this.getCurrentTarget().hasAuraByMe("Deathmark")),
      spell.cast("Fireblood", on => this.getCurrentTarget(), req => this.getCurrentTarget().hasAuraByMe("Deathmark")),
      spell.cast("Ancestral Call", on => this.getCurrentTarget(), req => (!this.hasTalent("Kingsbane") && this.getCurrentTarget().hasAuraByMe("Deathmark") && this.getCurrentTarget().hasAuraByMe("Shiv")) || (this.hasTalent("Kingsbane") && this.getCurrentTarget().hasAuraByMe("Deathmark") && this.getCurrentTarget().hasAuraByMe("Kingsbane") && this.getDebuffRemainingTime("Kingsbane") < 8))
    );
  }

  energyPooling() {
    return spell.cast("Pool Energy", req => me.powerByType(PowerType.Energy) < 50 && !this.notPooling);
  }

  // Helper methods
  getCurrentTarget() {
    let target;
  
    // Check if current target is valid and alive
    if (me.targetUnit && !me.targetUnit.dead && me.targetUnit.health > 0 && me.targetUnit.distanceTo(me) <= 10) {
      target = me.targetUnit;
    } else {
      // Find the closest living enemy
      target = combat.targets
        .filter(unit => !unit.dead && unit.health > 0 && unit.distanceTo(me) <= 10 && me.isFacing(unit))
        .sort((a, b) => a.distanceTo(me) - b.distanceTo(me))[0] || me.targetUnit;
    }
  
    return target;
  }

  hasTalent(talentName) {
    return me.hasAura(talentName);
  }

  getValidTargets() {
    return combat.targets.filter(unit => 
      unit.distanceTo(me) <= 10 && 
      !unit.dead && 
      me.isFacing(unit) && 
      me.inCombat
    );
  }
  
  isRefreshable(spellName) {
    const validTargets = this.getValidTargets();
    return validTargets.some(target => {
      const aura = target.getAuraByMe(spellName);
      if (!aura) return true; // If the aura doesn't exist on this target, it's refreshable
      return this.getPmultiplier(spellName, target) <= 1;
    });
  }
  
  getPmultiplier(spellName, target) {
    if (!target) return 0;
    const remainingTime = this.getDebuffRemainingTime(spellName, target);
    if (remainingTime === 0) return 0;
    
    const spellObject = spell.getSpell(spellName);
    if (!spellObject) {
      console.warn(`Spell ${spellName} not found`);
      return 0;
    }
    const baseDuration = spellObject.duration / 1000; // Convert milliseconds to seconds
    if (!baseDuration) {
      console.warn(`Base duration for ${spellName} not found`);
      return 12;
    }
    return remainingTime / (baseDuration * 0.3);
  }
  
  getLowestPmultiplier(spellName) {
    const validTargets = this.getValidTargets();
    if (validTargets.length === 0) return 0;
  
    return Math.min(...validTargets.map(target => this.getPmultiplier(spellName, target)));
  }

  getDebuffRemainingTime(debuffName, target) {
    const debuff = target ? target.getAura(debuffName) : null;
    return debuff ? debuff.remaining / 1000 : 0; // Convert milliseconds to seconds
  }

  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining / 1000 : 0; // Convert milliseconds to seconds
  }

  getTargetTimeToDie() {
    const target = this.getCurrentTarget();
    return target ? target.timeToDeath() : 0;
  }

  shouldUseDeathmark() {
    return !me.hasAura("Stealth") &&
           me.hasAura("Slice and Dice") &&
           this.getAuraRemainingTime("Slice and Dice") > 5 &&
           this.getCurrentTarget().hasAuraByMe("Rupture") &&
           me.hasAura("Envenom") &&
           !this.getCurrentTarget().hasAuraByMe("Deathmark") &&
           this.deathmarkMaCondition() &&
           this.deathmarkKingsbaneCondition();
  }

  deathmarkMaCondition() {
    return !this.hasTalent("Master Assassin") || this.getCurrentTarget().hasAuraByMe("Garrote");
  }

  deathmarkKingsbaneCondition() {
    return !this.hasTalent("Kingsbane") || spell.getCooldown("Kingsbane").remaining <= 2;
  }

  useShiv() {
    return new bt.Selector(
      spell.cast("Shiv", on => this.getCurrentTarget(), req => this.hasTalent("Arterial Precision") && this.shivCondition && this.getEnemiesInRange(10) >= 4 && this.getCurrentTarget().hasAuraByMe("Crimson Tempest")),
      spell.cast("Shiv", on => this.getCurrentTarget(), req => !this.hasTalent("Lightweight Shiv") && this.shivKingsbaneCondition && (this.getCurrentTarget().hasAuraByMe("Kingsbane") && this.getDebuffRemainingTime("Kingsbane") < 8 || spell.getCooldown("Kingsbane").remaining >= 24) && (!this.hasTalent("Crimson Tempest") || this.singleTarget || this.getCurrentTarget().hasAuraByMe("Crimson Tempest"))),
      spell.cast("Shiv", on => this.getCurrentTarget(), req => this.hasTalent("Lightweight Shiv") && this.shivKingsbaneCondition && (this.getCurrentTarget().hasAuraByMe("Kingsbane") || spell.getCooldown("Kingsbane").remaining <= 1)),
      spell.cast("Shiv", on => this.getCurrentTarget(), req => this.hasTalent("Arterial Precision") && this.shivCondition && this.getCurrentTarget().hasAuraByMe("Deathmark")),
      spell.cast("Shiv", on => this.getCurrentTarget(), req => !this.hasTalent("Kingsbane") && !this.hasTalent("Arterial Precision") && this.shivCondition && (!this.hasTalent("Crimson Tempest") || this.singleTarget || this.getCurrentTarget().hasAuraByMe("Crimson Tempest"))),
      spell.cast("Shiv", on => this.getCurrentTarget(), req => this.getTargetTimeToDie() <= spell.getCharges("Shiv") * 8)
    );
  }

  useMiscCooldowns() {
    return new bt.Selector(
      spell.cast("Blood Fury", on => this.getCurrentTarget(), req => this.getCurrentTarget().hasAuraByMe("Deathmark")),
      spell.cast("Berserking", on => this.getCurrentTarget(), req => this.getCurrentTarget().hasAuraByMe("Deathmark")),
      spell.cast("Fireblood", on => this.getCurrentTarget(), req => this.getCurrentTarget().hasAuraByMe("Deathmark")),
      spell.cast("Ancestral Call", on => this.getCurrentTarget(), req => (!this.hasTalent("Kingsbane") && this.getCurrentTarget().hasAuraByMe("Deathmark") && this.getCurrentTarget().hasAuraByMe("Shiv")) || (this.hasTalent("Kingsbane") && this.getCurrentTarget().hasAuraByMe("Deathmark") && this.getCurrentTarget().hasAuraByMe("Kingsbane") && this.getDebuffRemainingTime("Kingsbane") < 8))
    );
  }

  useVanish() {
    return new bt.Selector(
      spell.cast("Vanish", req => !me.hasAura("Fatebound Lucky Coin") && (me.getAuraStacks("Fatebound Coin Tails") >= 5 || me.getAuraStacks("Fatebound Coin Heads") >= 5)),
      spell.cast("Vanish", req => !this.hasTalent("Master Assassin") && !this.hasTalent("Indiscriminate Carnage") && this.hasTalent("Improved Garrote") && spell.getCooldown("Garrote").ready && (this.getPmultiplier("Garrote") <= 1 || this.isRefreshable("Garrote")) && (this.getCurrentTarget().hasAuraByMe("Deathmark") || spell.getCooldown("Deathmark").remaining < 4) && this.comboPointsDeficit >= Math.min(this.getEnemiesInRange(10), 4)),
      spell.cast("Vanish", req => !this.hasTalent("Master Assassin") && this.hasTalent("Indiscriminate Carnage") && this.hasTalent("Improved Garrote") && spell.getCooldown("Garrote").ready && (this.getPmultiplier("Garrote") <= 1 || this.isRefreshable("Garrote")) && this.getEnemiesInRange(10) > 2 && (this.getTargetTimeToDie() - this.getDebuffRemainingTime("Garrote") > 15 || this.getTimeToAdds() > 20)),
      spell.cast("Vanish", req => !this.hasTalent("Improved Garrote") && this.hasTalent("Master Assassin") && !this.isRefreshable("Rupture") && this.getDebuffRemainingTime("Garrote") > 3 && this.getCurrentTarget().hasAuraByMe("Deathmark") && (this.getCurrentTarget().hasAuraByMe("Shiv") || this.getDebuffRemainingTime("Deathmark") < 4)),
      spell.cast("Vanish", req => this.hasTalent("Improved Garrote") && spell.getCooldown("Garrote").ready && (this.getPmultiplier("Garrote") <= 1 || this.isRefreshable("Garrote")) && (this.getCurrentTarget().hasAuraByMe("Deathmark") || spell.getCooldown("Deathmark").remaining < 4) && this.getTimeToAdds() > 30),
      spell.cast("Vanish", req => !this.hasTalent("Improved Garrote") && me.hasAura("Darkest Night") && this.comboPointsDeficit >= 3 && this.singleTarget)
    );
  }

  drawTargetNgon() {
    const currentTime = Date.now();
    if (currentTime - this.lastDrawTime >= this.drawInterval) {
      const target = this.getCurrentTarget();
      if (target && !target.dead && target.health > 0) {
        const boundingRadius = target.boundingRadius || 1;
        const interactionRadius = boundingRadius;
        drawNgonAroundTarget(target, interactionRadius);
      }
      this.lastDrawTime = currentTime;
    }
  }

  getEffectiveComboPoints() {
    const comboPoints = me.powerByType(4); // Assuming 4 is the index for Combo Points
  
    if ((comboPoints === 2 && me.hasVisibleAura("323558")) ||
        (comboPoints === 3 && me.hasVisibleAura("323559")) ||
        (comboPoints === 4 && me.hasVisibleAura("323560")) ||
        (comboPoints === 5 && me.hasVisibleAura("354838"))) {
      return 7; // Treat as max combo points
    }
  
    return comboPoints;
  }

  // Additional properties
  get singleTarget() {
    return this.getEnemiesInRange(this.AOE_RANGE).length === 1;
  }

  get notPooling() {
    return (this.getCurrentTarget().hasAuraByMe("Deathmark") || this.getCurrentTarget().hasAuraByMe("Kingsbane") || this.getCurrentTarget().hasAuraByMe("Shiv"))
      || (me.hasVisibleAura("Envenom") && this.getAuraRemainingTime("Envenom") <= 1)
      || me.powerByType(PowerType.Energy) >= (40 + 30 * Number(this.hasTalent("Hand of Fate")) - 15 * Number(this.hasTalent("Vicious Venoms")))
      || this.getTargetTimeToDie() <= 20;
  }

  get maxComboPoints() {
    // Base max combo points
    let max = 5;
    
    // Add points for talents that increase max combo points
    if (this.hasTalent("Deeper Stratagem")) max += 1;
    if (this.hasTalent("Sanguine Stratagem")) max += 1;    
    return max;
  }

  get comboPointsDeficit() {
    return this.getComboPointsMaxSpend() - this.getEffectiveComboPoints();
  }
  
  get effectiveCPSpend() {
    return Math.max(this.getComboPointsMaxSpend() - 2, 5 * Number(this.hasTalent("Hand of Fate")));
  }

  get regenSaturated() {
    return me.powerByType(PowerType.Energy) > 80;
  }

  get shivCondition() {
    return !this.getCurrentTarget().hasAuraByMe("Shiv") && this.getCurrentTarget().hasAuraByMe("Garrote") && this.getCurrentTarget().hasAuraByMe("Rupture");
  }

  get shivKingsbaneCondition() {
    return this.hasTalent("Kingsbane") && me.hasAura("Envenom") && this.shivCondition;
  }

  get useFiller() {
    return this.comboPointsDeficit > 1 || this.notPooling || !this.singleTarget;
  }

  get useCausticFiller() {
    return this.hasTalent("Caustic Spatter") && 
           this.getCurrentTarget().hasAuraByMe("Rupture") && 
           (!this.getCurrentTarget().hasAuraByMe("Caustic Spatter") || this.getDebuffRemainingTime("Caustic Spatter") <= 2) && 
           this.comboPointsDeficit > 1 && 
           !this.singleTarget;
  }

  getTimeToAdds() {
    // Implement logic to predict when adds will spawn
    return 9999; // Default to a high value if no adds are expected
  }

  getEnemiesInRange(range) {
    return combat.targets.filter(unit => unit.distanceTo(me) <= range);
  }

  get dotFinisherCondition() {
    return this.getEffectiveComboPoints() >= this.effectiveCPSpend;
  }
  
  get envenomFinisherCondition() {
    return this.getEffectiveComboPoints() >= this.effectiveCPSpend;
  }

getComboPointsMaxSpend() {
    return 5 + 
      (me.hasAura("Deeper Stratagem") ? 1 : 0) + 
      (me.hasAura("Sanguine Stratagem") ? 1 : 0)
  }
}

export default RogueAssassinationNewBehavior;
