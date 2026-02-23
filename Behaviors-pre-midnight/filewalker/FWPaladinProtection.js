import { Behavior, BehaviorContext } from '@/Core/Behavior';
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from '@/Core/Spell';
import Settings from "@/Core/Settings";
import CombatTimer from '@/Core/CombatTimer';
import objMgr from "@/Core/ObjectManager";
import { me } from '@/Core/ObjectManager';
import { defaultCombatTargeting as combat } from '@/Targeting/CombatTargeting';

// Core auras and spell IDs for Protection Paladin
const auras = {
  // Buffs
  avengingWrath: 31884,        // Avenging Wrath
  devotionAura: 465,           // Devotion Aura
  consecration: 26573,         // Consecration
  shiningLightFree: 327510,    // Shining Light (free WoG)
  momentOfGlory: 327193,       // Moment of Glory
  blessingOfDawn: 385126,      // Blessing of Dawn (Of Dusk and Dawn)
  blessingOfDusk: 385127,      // Blessing of Dusk (Of Dusk and Dawn)
  bulwarkOfRighteousFury: 386652, // Bulwark of Righteous Fury
  divineResonance: 384814,     // Divine Resonance
  blessedAssurance: 386283,    // Blessed Assurance
  hammerOfLightReady: 385829,  // Hammer of Light ready
  hammerOfLightFree: 385828,   // Hammer of Light free
  shakeTheHeavens: 387174,     // Shake the Heavens buff
  divineGuidance: 384813,      // Divine Guidance (Consecration)
  sacredWeapon: 383891,        // Sacred Weapon (Holy Armaments)
  holyBulwark: 383914,         // Holy Bulwark (Holy Armaments)
  luckOfTheDraw: 407789,       // Luck of the Draw (TWW2 4P)
  
  // Debuffs
  judgment: 197277,            // Judgment debuff
  eyeOfTyr: 387174,            // Eye of Tyr debuff
  
  // Various talent auras to check for
  ofDuskAndDawn: 385125,       // Of Dusk and Dawn talent
  lightsGuidance: 391176,      // Light's Guidance talent
  righteousProtector: 204074,  // Righteous Protector talent
  bulwarkTalent: 386652,       // Bulwark of Righteous Fury talent
  refiningFire: 387246,        // Refining Fire talent
  hammerAndAnvil: 385313,      // Hammer and Anvil talent
  shakeTheTalent: 387170,      // Shake the Heavens talent
  blessedAssuranceTalent: 386283, // Blessed Assurance talent
  innermostLight: 386568,      // Innermost Light talent
  lightsDeliverance: 392911,   // Light's Deliverance talent
};

export class ProtectionPaladinBehavior extends Behavior {
  name = 'FW Protection Paladin';
  context = BehaviorContext.Any;
  specialization = Specialization.Paladin.Protection;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: "Rotation",
      options: [
        { type: "checkbox", uid: "PaladinProtUseEyeOfTyr", text: "Use Eye of Tyr", default: true },
        { type: "checkbox", uid: "PaladinProtUseHolyArmaments", text: "Use Holy Armaments", default: true },
        { type: "checkbox", uid: "PaladinProtPrioritizeDefensives", text: "Prioritize Defensive Rotation", default: false },
      ]
    },
    {
      header: "Cooldowns",
      options: [
        { type: "checkbox", uid: "PaladinProtUseAvengingWrath", text: "Use Avenging Wrath", default: true },
        { type: "checkbox", uid: "PaladinProtUseMomentOfGlory", text: "Use Moment of Glory", default: true },
        { type: "checkbox", uid: "PaladinProtUseRiteOfAdj", text: "Use Rite of Adjuration", default: true },
        { type: "checkbox", uid: "PaladinProtUseRiteOfSanc", text: "Use Rite of Sanctification", default: true },
      ]
    },
    {
      header: "Defensives",
      options: [
        { type: "checkbox", uid: "PaladinProtUseArdentDefender", text: "Use Ardent Defender", default: true },
        { type: "slider", uid: "PaladinProtArdentDefenderPercent", text: "Ardent Defender Percent", min: 1, max: 100, default: 35 },
        { type: "checkbox", uid: "PaladinProtUseGuardianOfAncientKings", text: "Use Guardian of Ancient Kings", default: true },
        { type: "slider", uid: "PaladinProtGoAKPercent", text: "Guardian of Ancient Kings Percent", min: 1, max: 100, default: 25 },
        { type: "checkbox", uid: "PaladinProtUseWordOfGlory", text: "Use Word of Glory for Healing", default: true },
        { type: "slider", uid: "PaladinProtWordOfGloryPercent", text: "Word of Glory Health Percent", min: 1, max: 100, default: 50 },
        { type: "checkbox", uid: "PaladinProtUseDivineShield", text: "Use Divine Shield", default: true },
        { type: "slider", uid: "PaladinProtDivineShieldPercent", text: "Divine Shield Health Percent", min: 1, max: 100, default: 15 },
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForNotSitting(),
      
      // End if no valid target
      new bt.Action(() => (this.getCurrentTarget() === null ? bt.Status.Success : bt.Status.Failure)),
      common.waitForTarget(),
      common.waitForFacing(),
      common.waitForCastOrChannel(),
      
      // Main rotation sequence
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          // Precombat actions
          this.precombatActions(),
          
          // Interrupt
          spell.interrupt('Rebuke'),
          
          // Defensive actions if prioritized
          new bt.Decorator(
            req => Settings.PaladinProtPrioritizeDefensives,
            this.defensiveActions()
          ),
          
          // Cooldowns
          this.cooldownActions(),
          
          // Trinkets
          // this.trinketActions(),
          
          // Defensive actions if not prioritized
          new bt.Decorator(
            req => !Settings.PaladinProtPrioritizeDefensives,
            this.defensiveActions()
          ),
          
          // Core rotation
          this.coreRotation(),
          
          // Standard actions - always available
          this.standardActions(),
          
          // Auto attack fallback
          spell.cast('Auto Attack', this.getCurrentTarget, req => true)
        )
      )
    );
  }

  // Helper methods
  hasTalent(talentName) {
    return spell.isSpellKnown(talentName);
  }

  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit);
    const target = me.targetUnit;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  // Get enemies within consecration
  getTargetsInConsecration() {
    const currentTarget = this.getCurrentTarget();
    if (!currentTarget || !me.hasAura(auras.consecration)) return 0;
    return this.getEnemiesInRange(8);
  }

  // Get enemies in range
  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  // Get remaining Holy Power to reach 2 stacks of Blessing of Dawn
  getHpgToTwoDawn() {
    // This would need to check actual game state in a real implementation
    // For now, just return 1 as a placeholder
    return 1;
  }

  // Check if Consecration is active under player
  isConsecrationActive() {
    return me.hasAura(auras.consecration);
  }

  // Check if Holy Power is capped or close to capping
  isHolyPowerCapped() {
    return me.powerByType(9) >= 4; // Holy Power is power type 9
  }

  // Get Holy Power from potential Judgment
  getJudgmentHolyPower() {
    const currentTarget = this.getCurrentTarget();
    if (!currentTarget || !currentTarget.hasAura(auras.judgment)) return 0;
    return 1;
  }

  // Check if Righteous Protector ICD is ready
  isRighteousProtectorReady() {
    // This would need to check an actual ICD in the game
    // For now, return true 75% of the time as a placeholder
    return Math.random() > 0.25;
  }

  // Precombat actions
  precombatActions() {
    return new bt.Selector(
      // Apply Rites
      spell.cast('Rite of Sanctification', on => me, req => 
        Settings.PaladinProtUseRiteOfSanc && !me.hasAura('Rite of Sanctification')
      ),
      
      spell.cast('Rite of Adjuration', on => me, req => 
        Settings.PaladinProtUseRiteOfAdj && !me.hasAura('Rite of Adjuration')
      ),
      
      // Apply Devotion Aura
      spell.cast('Devotion Aura', on => me, req => !me.hasAura(auras.devotionAura))
    );
  }

  // Cooldown actions
  cooldownActions() {
    return new bt.Selector(
      // Avenging Wrath
      spell.cast('Avenging Wrath', this.getCurrentTarget, req => 
        Settings.PaladinProtUseAvengingWrath && 
        this.getCurrentTarget() && 
        this.getEnemiesInRange(10) > 0
      ),
      
      // Moment of Glory
      spell.cast('Moment of Glory', this.getCurrentTarget, req => 
        Settings.PaladinProtUseMomentOfGlory && 
        ((me.hasAura(auras.avengingWrath) && me.getAura(auras.avengingWrath).remaining < 15000) || 
         CombatTimer.getCombatTimeSeconds() > 10)
      ),
      
      // Divine Toll on 3+ targets
      spell.cast('Divine Toll', this.getCurrentTarget, req => 
        this.getEnemiesInRange(30) >= 3
      ),
      
      // Bastion of Light during Avenging Wrath or if Avenging Wrath coming soon
      spell.cast('Bastion of Light', this.getCurrentTarget, req => 
        me.hasAura(auras.avengingWrath) || 
        spell.getCooldown('Avenging Wrath').timeleft <= 30000
      )
    );
  }

  // Defensive actions
  defensiveActions() {
    return new bt.Selector(
      // Divine Shield at critical health
      spell.cast('Divine Shield', on => me, req => 
        Settings.PaladinProtUseDivineShield && 
        me.pctHealth <= Settings.PaladinProtDivineShieldPercent &&
        spell.isSpellKnown('Divine Shield')
      ),
      
      // Guardian of Ancient Kings
      spell.cast('Guardian of Ancient Kings', on => me, req => 
        Settings.PaladinProtUseGuardianOfAncientKings && 
        me.pctHealth <= Settings.PaladinProtGoAKPercent &&
        spell.isSpellKnown('Guardian of Ancient Kings')
      ),
      
      // Ardent Defender
      spell.cast('Ardent Defender', on => me, req => 
        Settings.PaladinProtUseArdentDefender && 
        me.pctHealth <= Settings.PaladinProtArdentDefenderPercent
      ),
      
      // Word of Glory for emergency healing
      spell.cast('Word of Glory', on => me, req => 
        Settings.PaladinProtUseWordOfGlory && 
        me.pctHealth <= Settings.PaladinProtWordOfGloryPercent && 
        me.powerByType(9) >= 3 // Requires 3 Holy Power
      )
    );
  }

  // Trinket actions
  trinketActions() {
    return new bt.Selector(
      // Use trinkets with Avenging Wrath when possible
      common.useEquippedTrinket(1, req => me.hasAura(auras.avengingWrath)),
      common.useEquippedTrinket(2, req => me.hasAura(auras.avengingWrath)),
      
      // Use trinkets without Avenging Wrath if needed
      common.useEquippedTrinket(1),
      common.useEquippedTrinket(2)
    );
  }

  // Core rotation for Protection Paladin
  coreRotation() {
    return new bt.Selector(
      // Judgment if 2+ charges available
      spell.cast('Judgment', this.getCurrentTarget, req => 
        spell.getCharges('Judgment') >= 2 || 
        spell.getCooldown('Judgment').ready
      ),
      
      // Hammer of Light with buff
      spell.cast('Hammer of Light', this.getCurrentTarget, req => 
        me.hasAura(auras.hammerOfLightFree) || 
        me.hasAura(auras.shakeTheHeavens) || 
        !me.hasAura(auras.shakeTheHeavens) || 
        spell.getCooldown('Eye of Tyr').timeleft < 1500
      ),
      
      // Eye of Tyr with Light's Guidance
      spell.cast('Eye of Tyr', this.getCurrentTarget, req => 
        Settings.PaladinProtUseEyeOfTyr && 
        this.hasTalent('Light\'s Guidance') && 
        ((this.getHpgToTwoDawn() === 5 && this.hasTalent('Of Dusk and Dawn')) || 
         !this.hasTalent('Of Dusk and Dawn'))
      ),
      
      // Shield of the Righteous logic based on 4pc bonus
      spell.cast('Shield of the Righteous', this.getCurrentTarget, req => 
        !me.hasAura(auras.hammerOfLightReady) && 
        ((me.hasAura(auras.luckOfTheDraw) && 
          ((me.powerByType(9) + this.getJudgmentHolyPower() >= 5) || 
           (!this.hasTalent('Righteous Protector') || this.isRighteousProtectorReady()))) || 
         
         (this.hasTalent('Righteous Protector') && 
          me.hasAura('set_bonus.thewarwithin_season_2_4pc') && 
          ((me.powerByType(9) + this.getJudgmentHolyPower() > 5) || 
           (me.powerByType(9) + this.getJudgmentHolyPower() >= 5 && this.isRighteousProtectorReady()))) ||
            
         (!me.hasAura('set_bonus.thewarwithin_season_2_4pc') && 
          (!this.hasTalent('Righteous Protector') || this.isRighteousProtectorReady())))
      ),
      
      // Judgment on 3+ targets with Bulwark stacks
      spell.cast('Judgment', this.getCurrentTarget, req => 
        this.getEnemiesInRange(10) > 3 && 
        me.getAuraStacks(auras.bulwarkOfRighteousFury) >= 3 && 
        me.powerByType(9) < 3
      ),
      
      // Avenger's Shield for Bulwark
      spell.cast('Avenger\'s Shield', this.getCurrentTarget, req => 
        !me.hasAura(auras.bulwarkOfRighteousFury) && 
        this.hasTalent('Bulwark of Righteous Fury') && 
        this.getEnemiesInRange(10) >= 3
      ),
      
      // Blessed Hammer with Blessed Assurance
      spell.cast('Blessed Hammer', this.getCurrentTarget, req => 
        this.hasTalent('Blessed Hammer') && 
        me.hasAura(auras.blessedAssurance) && 
        this.getEnemiesInRange(10) < 3 && 
        !me.hasAura(auras.avengingWrath)
      ),
      
      // Hammer of the Righteous with Blessed Assurance
      spell.cast('Hammer of the Righteous', this.getCurrentTarget, req => 
        !this.hasTalent('Blessed Hammer') && 
        me.hasAura(auras.blessedAssurance) && 
        this.getEnemiesInRange(10) < 3 && 
        !me.hasAura(auras.avengingWrath)
      ),
      
      // Consecration with max Divine Guidance stacks
      spell.cast('Consecration', this.getCurrentTarget, req => 
        me.getAuraStacks(auras.divineGuidance) === 5
      ),
      
      // Holy Armaments for Sacred Weapon
      spell.cast('Holy Armaments', this.getCurrentTarget, req => 
        Settings.PaladinProtUseHolyArmaments && 
        (!me.hasAura(auras.sacredWeapon) || 
         (me.getAura(auras.sacredWeapon).remaining < 6000 && 
          !me.hasAura(auras.avengingWrath) && 
          spell.getCooldown('Avenging Wrath').timeleft <= 30000))
      ),
      
      // Hammer of Wrath
      spell.cast('Hammer of Wrath', this.getCurrentTarget, req => true),
      
      // Divine Toll as filler
      spell.cast('Divine Toll', this.getCurrentTarget, req => true),
      
      // Avenger's Shield with Refining Fire
      spell.cast('Avenger\'s Shield', this.getCurrentTarget, req => 
        this.hasTalent('Refining Fire')
      ),
      
      // Judgment with Hammer and Anvil during Avenging Wrath
      spell.cast('Judgment', this.getCurrentTarget, req => 
        me.hasAura(auras.avengingWrath) && 
        this.hasTalent('Hammer and Anvil')
      )
    );
  }

  // Standard actions - always available fallback options
  standardActions() {
    return new bt.Selector(
      // Holy Armaments for Holy Bulwark with 2 charges
      spell.cast('Holy Armaments', this.getCurrentTarget, req => 
        Settings.PaladinProtUseHolyArmaments && 
        spell.getCharges('Holy Armaments') === 2
      ),

      // Judgment
      spell.cast('Judgment', this.getCurrentTarget, req => true),

      // Avenger's Shield without Light's Guidance
      spell.cast('Avenger\'s Shield', this.getCurrentTarget, req => 
        !this.hasTalent('Light\'s Guidance')
      ),

      // Consecration if not active
      spell.cast('Consecration', this.getCurrentTarget, req => 
        !this.isConsecrationActive()
      ),

      // Eye of Tyr for multiple targets
      spell.cast('Eye of Tyr', this.getCurrentTarget, req => 
        Settings.PaladinProtUseEyeOfTyr && 
        (this.hasTalent('Innermost Light') || this.getEnemiesInRange(10) >= 3) && 
        !this.hasTalent('Light\'s Deliverance')
      ),

      // Holy Armaments for Holy Bulwark
      spell.cast('Holy Armaments', this.getCurrentTarget, req => 
        Settings.PaladinProtUseHolyArmaments
      ),

      // Blessed Hammer
      spell.cast('Blessed Hammer', this.getCurrentTarget, req => 
        this.hasTalent('Blessed Hammer')
      ),

      // Hammer of the Righteous
      spell.cast('Hammer of the Righteous', this.getCurrentTarget, req => 
        !this.hasTalent('Blessed Hammer')
      ),

      // Word of Glory with free proc and right conditions
      spell.cast('Word of Glory', on => me, req => 
        me.hasAura(auras.shiningLightFree) && 
        (this.hasTalent('Blessed Assurance') || 
        (this.hasTalent('Light\'s Guidance') && this.isRighteousProtectorReady()))
      ),

      // Avenger's Shield catch-all
      spell.cast('Avenger\'s Shield', this.getCurrentTarget, req => true),

      // Eye of Tyr
      spell.cast('Eye of Tyr', this.getCurrentTarget, req => 
        Settings.PaladinProtUseEyeOfTyr && 
        !this.hasTalent('Light\'s Deliverance')
      ),

      // Word of Glory with free proc
      spell.cast('Word of Glory', on => me, req => 
        me.hasAura(auras.shiningLightFree)
      ),

      // Arcane Torrent for Holy Power
      spell.cast('Arcane Torrent', this.getCurrentTarget, req => 
        me.powerByType(9) < 5 && 
        this.hasTalent('Arcane Torrent')
      ),

      // Consecration last resort
      spell.cast('Consecration', this.getCurrentTarget, req => true)
    );
  }
}