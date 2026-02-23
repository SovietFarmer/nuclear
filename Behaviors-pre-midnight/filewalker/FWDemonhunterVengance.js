import { Behavior, BehaviorContext } from '@/Core/Behavior';
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import Common from '@/Core/Common';
import Spell from '@/Core/Spell';
import Settings from '@/Core/Settings';
import { PowerType } from "@/Enums/PowerType";
import { me } from '@/Core/ObjectManager';
import { defaultCombatTargeting as combat } from '@/Targeting/CombatTargeting';

export class VengeanceDemonHunterBehavior extends Behavior {
  name = 'FW Vengeance Demon Hunter';
  context = BehaviorContext.Any;
  specialization = Specialization.DemonHunter.Vengeance;
  version = wow.gameVersion;

  // Hero Talent detection constants
  static HERO_TALENTS = {
    ALDRACHI_REAVER: "Art of the Glaive", // Top talent for Aldrachi Reaver
    FEL_SCARRED: "Demonsurge",            // Top talent for Fel-Scarred
  };

  // Spell IDs from spellIDs.js
  static SPELL_IDS = {
    // General
    DEMON_SPIKES: 203720,
    FIERY_BRAND: 204021,
    META_VENGEANCE: 187827,
    FEL_DEVASTATION: 212084,
    IMMOLATION_AURA: 258920,
    THE_HUNT: 370965,
    SIGIL_OF_FLAME: 204596,
    FELBLADE: 232893,
    THROW_GLAIVE: 185123,
    DISRUPT: 183752,
    
    // Vengeance specific
    SOUL_CLEAVE: 228477,
    FRACTURE: 263642,
    SOUL_CARVER: 207407,
    SPIRIT_BOMB: 247454,
    SIGIL_OF_SPITE: 389401,
    REAVERS_GLAIVE: 425364,
    TAUNT: 185245,
  };

  static settings = [
    {
      header: 'Vengeance Demon Hunter Settings',
      options: [
        { 
          uid: 'VengUseMetamorphosis', 
          text: 'Use Metamorphosis', 
          type: 'checkbox', 
          default: true 
        },
        { 
          uid: 'VengAOEThreshold', 
          text: 'AOE Threshold', 
          type: 'slider', 
          min: 2, 
          max: 8, 
          default: 3
        },
        { 
          uid: 'VengSpiritBombThreshold', 
          text: 'Spirit Bomb Min Targets', 
          type: 'slider', 
          min: 0, 
          max: 8, 
          default: 6
        },
        { 
          uid: 'VengFelbladeThreshold', 
          text: 'Felblade Fury Threshold', 
          type: 'slider', 
          min: 10, 
          max: 150, 
          default: 80
        },
        { 
          uid: 'VengUseSigils', 
          text: 'Use Sigils', 
          type: 'checkbox', 
          default: true 
        },
        {
          uid: 'VengPreferFieryBrand',
          text: 'Optimize for Fiery Brand',
          type: 'checkbox',
          default: true
        },
        {
          uid: 'VengAutoTaunt',
          text: 'Auto Taunt Enemies',
          type: 'checkbox',
          default: true
        }
      ],
    },
    {
      header: 'Defensive Settings',
      options: [
        { 
          uid: 'VengDefensiveThreshold', 
          text: 'Defensive Cooldown Health %', 
          type: 'slider', 
          min: 20, 
          max: 90, 
          default: 60 
        },
        { 
          uid: 'VengDemonSpikesCharges', 
          text: 'Demon Spikes Min Charges', 
          type: 'slider', 
          min: 0, 
          max: 2, 
          default: 1
        },
        { 
          uid: 'VengDemonSpikesThreshold', 
          text: 'Demon Spikes Health %', 
          type: 'slider', 
          min: 20, 
          max: 100, 
          default: 85 
        },
        { 
          uid: 'VengFieryBrandThreshold', 
          text: 'Fiery Brand Health %', 
          type: 'slider', 
          min: 20, 
          max: 100, 
          default: 70 
        },
        { 
          uid: 'VengMetamorphosisThreshold', 
          text: 'Metamorphosis Health %', 
          type: 'slider', 
          min: 20, 
          max: 80, 
          default: 50 
        }
      ]
    }
  ];

  build() {
    return new bt.Selector(
      Common.waitForCastOrChannel(),
      Common.waitForNotMounted(),
      new bt.Action(() => {
        if (!this.getCurrentTarget()) return bt.Status.Success;
        
        // Log detected hero talent path for debugging (only once when target changes)
        if (this._lastTarget !== this.getCurrentTarget()) {
          this._lastTarget = this.getCurrentTarget();
          const heroTalent = this.detectHeroTalent();
          if (heroTalent) {
            // console.info(`Detected Hero Talent: ${heroTalent}`);
          } else {
            console.info("No Hero Talent detected. Using default rotation.");
          }
        }
        
        return bt.Status.Failure;
      }),
      Common.waitForTarget(),
      Common.waitForFacing(),
      Common.ensureAutoAttack(),

      new bt.Selector(
        this.defensives(),
        
        
        new bt.Decorator(
          () => !Spell.isGlobalCooldown(),
          new bt.Selector(
            // Interrupt with priority
            Spell.interrupt('Disrupt'),
            this.autoTaunt(),
            this.catchLoseEnemies(),
            // Main rotation selector
            new bt.Selector(
              this.aldrachiReaverRotation(),
              this.felScarredRotation(),
              this.defaultRotation()
            ),
          )
        )
      )
    );
  }

  // Auto taunt functionality
  autoTaunt() {
    return new bt.Decorator(
      () => Settings.VengAutoTaunt && !Spell.isGlobalCooldown(),
      new bt.Action(() => {
        if (!me.inCombat()) return bt.Status.Failure;
        
        // Get nearby enemies in combat with us
        const nearbyEnemies = combat.targets.filter(unit => 
          unit instanceof wow.CGUnit && 
          unit.inCombat(me) && 
          !unit.deadOrGhost && 
          me.distanceTo(unit) < 30
        );
        
        // Check for enemies that are targeting someone else
        for (const enemy of nearbyEnemies) {
          if (enemy.target && !enemy.target.equals(me.guid) )
          {
            Spell.cast("Torment", enemy.target);
            console.info(`GET OVER HERE! ${enemy.unsafeName}`);
          }
        }
        
        return bt.Status.Failure;
      })
    );
  }

    // Auto taunt functionality
  catchLoseEnemies() {
    return new bt.Decorator(
      () => !Spell.isGlobalCooldown(),
      new bt.Action(() => {
        if (!me.inCombat()) return bt.Status.Failure;
        
        // Get nearby enemies in combat with us
        const nearbyEnemies = combat.targets.filter(unit => 
          unit instanceof wow.CGUnit && 
          unit.inCombat(me) && 
          !unit.deadOrGhost && 
          me.distanceTo(unit) < 30
        );
        
        // Check for enemies that are targeting someone else
        for (const enemy of nearbyEnemies) {
          if (enemy.target && 
              !enemy.target.equals(me.guid) && 
              Spell.getTimeSinceLastCast('Throw Glaive') > 2000 &&
              Spell.getCooldown('Throw Glaive').ready) {
            
            // Use taunt on this enemy
            if (Spell.getSpell('Throw Glaive').cast(enemy)) {
              console.info(`Auto-Glaiving ${enemy.unsafeName} who is targeting someone else`);
              return bt.Status.Success;
            }
          }
        }
        
        return bt.Status.Failure;
      })
    );
  }

  // Defensive cooldown usage
  defensives() {
    return new bt.Decorator(
      () => !Spell.isGlobalCooldown(),
      new bt.Selector(
        // Demon Spikes for physical damage mitigation
        Spell.cast('Demon Spikes', () => me, () => 
          me.pctHealth <= Settings.VengDemonSpikesThreshold && 
          !me.hasAura('Demon Spikes') && 
          Spell.getCharges('Demon Spikes') > Settings.VengDemonSpikesCharges),
        
        // Fiery Brand for major damage reduction
        Spell.cast('Fiery Brand', this.getCurrentTarget, () => 
          me.pctHealth <= Settings.VengFieryBrandThreshold && 
          this.getCurrentTarget() && 
          !this.getCurrentTarget().hasAuraByMe('Fiery Brand')),
        
        // Metamorphosis for emergency damage reduction and healing
        Spell.cast('Metamorphosis', () => me, () => 
          Settings.VengUseMetamorphosis && 
          me.pctHealth <= Settings.VengMetamorphosisThreshold && 
          !me.hasAura('Metamorphosis')),
        
        // Fel Devastation for healing when low health
        Spell.cast('Fel Devastation', this.getCurrentTarget, () => 
          me.pctHealth <= Settings.VengDefensiveThreshold && 
          this.getFury() >= 50),
        
        // Soul Cleave for emergency healing
        Spell.cast('Soul Cleave', this.getCurrentTarget, () => 
          me.pctHealth <= Settings.VengDefensiveThreshold && 
          this.getFury() >= 30)
      )
    );
  }

  // Aldrachi Reaver rotation
  aldrachiReaverRotation() {
    return new bt.Decorator(
      () => this.isAldrachiReaver(),
      new bt.Selector(
        // Use Reaver's Glaive when we have Art of the Glaive proc
        Spell.cast("Reaver's Glaive", this.getCurrentTarget, () => this.getArtOfTheGlaiveProc()),
        
        // Check for Reaver's Glaive empowerment
        new bt.Decorator(
          () => me.hasAura("Reaver's Glaive"),
          new bt.Selector(
            // Use Fracture Empowered by Reaver's Glaive
            Spell.cast('Fracture', this.getCurrentTarget),
            
            // Use Soul Cleave Empowered by Reaver's Glaive
            Spell.cast('Soul Cleave', this.getCurrentTarget, () => this.getFury() >= 30)
          )
        ),
        
        // Use The Hunt if talented
        Spell.cast('The Hunt', this.getCurrentTarget, () => Spell.isSpellKnown('The Hunt')),
        
        // Use Sigil of Spite if talented
        Spell.cast('Sigil of Spite', this.getCurrentTarget, () => 
          Settings.VengUseSigils && Spell.isSpellKnown('Sigil of Spite')),
        
        // Fiery Brand if no targets have it
        Spell.cast('Fiery Brand', this.getCurrentTarget, () => 
          this.getCurrentTarget() && !this.getCurrentTarget().hasAuraByMe('Fiery Brand')),
        
        // Soul Carver with Fiery Brand synergy
        Spell.cast('Soul Carver', this.getCurrentTarget, () => 
          !Settings.VengPreferFieryBrand || (
            this.getCurrentTarget() && 
            this.getCurrentTarget().hasAuraByMe('Fiery Brand') && 
            this.getRemainingTime(this.getCurrentTarget(), 'Fiery Brand') > 3000
          )),
        
        // Fel Devastation with Fiery Brand synergy
        Spell.cast('Fel Devastation', this.getCurrentTarget, () => 
          this.getFury() >= 50 && (
            !Settings.VengPreferFieryBrand || (
              this.getCurrentTarget() && 
              this.getCurrentTarget().hasAuraByMe('Fiery Brand') && 
              this.getRemainingTime(this.getCurrentTarget(), 'Fiery Brand') > 2000
            )
          )),
        
        // Sigil of Flame
        Spell.cast('Sigil of Flame', this.getCurrentTarget, () => Settings.VengUseSigils),
        
        // Immolation Aura
        Spell.cast('Immolation Aura'),
        
        // Spirit Bomb with enough soul fragments and targets
        Spell.cast('Spirit Bomb', this.getCurrentTarget, () => 
          Settings.VengSpiritBombThreshold > 0 && 
          this.getEnemyCount() >= Settings.VengSpiritBombThreshold),
        
        // Fracture if close to max charges
        Spell.cast('Fracture', this.getCurrentTarget, () => 
          Spell.getCharges('Fracture') > 1.7),
        
        // Felblade for Fury generation
        Spell.cast('Felblade', this.getCurrentTarget, () => 
          this.getFury() < Settings.VengFelbladeThreshold),
        
        // Soul Cleave to spend Fury
        Spell.cast('Soul Cleave', this.getCurrentTarget, () => this.getFury() >= 30),
        
        // Fracture for Soul Fragments and Fury
        Spell.cast('Fracture', this.getCurrentTarget),
        
        // Throw Glaive as filler
        Spell.cast('Throw Glaive', this.getCurrentTarget),
        
        // Regular auto-attacks
        new bt.Action(() => bt.Status.Success)
      )
    );
  }

  // Fel-Scarred rotation
  felScarredRotation() {
    return new bt.Decorator(
      () => this.isFelScarred(),
      new bt.Selector(
        // Use Metamorphosis after Fel Devastation cycle
        Spell.cast('Metamorphosis', () => me, () => 
          Settings.VengUseMetamorphosis && 
          !me.hasAura('Metamorphosis') && 
          Spell.getTimeSinceLastCast('Fel Devastation') < 5000),
        
        // Handle any Empowered abilities during Metamorphosis
        new bt.Decorator(
          () => me.hasAura('Metamorphosis'),
          new bt.Selector(
            // Priority to empowered abilities
            Spell.cast('Fel Devastation', this.getCurrentTarget, () => this.getFury() >= 50),
            Spell.cast('Immolation Aura')
          )
        ),
        
        // Use The Hunt if talented
        Spell.cast('The Hunt', this.getCurrentTarget, () => Spell.isSpellKnown('The Hunt')),
        
        Spell.cast('Soul Sunder', this.getCurrentTarget, () => me.hasAura('Metamorphosis')),
        
        // Use Sigil of Spite if talented
        Spell.cast('Sigil of Spite', this.getCurrentTarget, () => 
          Settings.VengUseSigils && Spell.isSpellKnown('Sigil of Spite')),
        
        // Fiery Brand if no targets have it
        Spell.cast('Fiery Brand', this.getCurrentTarget, () => 
          this.getCurrentTarget() && !this.getCurrentTarget().hasAuraByMe('Fiery Brand')),
        
        // Soul Carver with Fiery Brand synergy
        Spell.cast('Soul Carver', this.getCurrentTarget, () => 
          !Settings.VengPreferFieryBrand || (
            this.getCurrentTarget() && 
            this.getCurrentTarget().hasAuraByMe('Fiery Brand') && 
            this.getRemainingTime(this.getCurrentTarget(), 'Fiery Brand') > 3000
          )),
        
        // Fel Devastation with Fiery Brand synergy
        Spell.cast('Fel Devastation', this.getCurrentTarget, () => 
          this.getFury() >= 50 && (
            !Settings.VengPreferFieryBrand || (
              this.getCurrentTarget() && 
              this.getCurrentTarget().hasAuraByMe('Fiery Brand') && 
              this.getRemainingTime(this.getCurrentTarget(), 'Fiery Brand') > 2000
            )
          )),
        
        // Sigil of Flame (special logic for Illuminated Sigils)
        Spell.cast('Sigil of Flame', this.getCurrentTarget, () => 
          Settings.VengUseSigils && (
            !Spell.isSpellKnown('Illuminated Sigils') || 
            !me.hasAura('Student of Suffering')
          )),
        
        // Immolation Aura
        Spell.cast('Immolation Aura'),
        
        // Spirit Bomb with enough soul fragments and targets
        Spell.cast('Spirit Bomb', this.getCurrentTarget, () => 
          Settings.VengSpiritBombThreshold > 0 && 
          this.getEnemyCount() >= Settings.VengSpiritBombThreshold),
        
        // Fracture if close to max charges
        Spell.cast('Fracture', this.getCurrentTarget, () => 
          Spell.getCharges('Fracture') > 1.7),
        
        // Felblade for Fury generation (higher threshold for Fel-Scarred)
        Spell.cast('Felblade', this.getCurrentTarget, () => 
          this.getFury() < 130),
        
        // Soul Cleave to spend Fury
        Spell.cast('Soul Cleave', this.getCurrentTarget, () => this.getFury() >= 30),
        
        // Fracture for Soul Fragments and Fury
        Spell.cast('Fracture', this.getCurrentTarget),
        
        // Throw Glaive as filler
        Spell.cast('Throw Glaive', this.getCurrentTarget),
        
        // Regular auto-attacks
        new bt.Action(() => bt.Status.Success)
      )
    );
  }

  defaultRotation() {
    return new bt.Decorator(
      () => this.isDefaultRotation(),
      new bt.Selector(
        // Use Reaver's Glaive when we have Art of the Glaive proc
        Spell.cast("Reaver's Glaive", this.getCurrentTarget, () => this.getArtOfTheGlaiveProc()),
        
        // Check for Reaver's Glaive empowerment
        new bt.Decorator(
          () => me.hasAura("Reaver's Glaive"),
          new bt.Selector(
            // Use Fracture Empowered by Reaver's Glaive
            Spell.cast('Fracture', this.getCurrentTarget),
            
            // Use Soul Cleave Empowered by Reaver's Glaive
            Spell.cast('Soul Cleave', this.getCurrentTarget, () => this.getFury() >= 30)
          )
        ),
        
        // Use The Hunt if talented
        Spell.cast('The Hunt', this.getCurrentTarget, () => Spell.isSpellKnown('The Hunt')),
        
        // Use Sigil of Spite if talented
        Spell.cast('Sigil of Spite', this.getCurrentTarget, () => 
          Settings.VengUseSigils && Spell.isSpellKnown('Sigil of Spite')),
        
        // Fiery Brand if no targets have it
        Spell.cast('Fiery Brand', this.getCurrentTarget, () => 
          this.getCurrentTarget() && !this.getCurrentTarget().hasAuraByMe('Fiery Brand')),
        
        // Soul Carver with Fiery Brand synergy
        Spell.cast('Soul Carver', this.getCurrentTarget, () => 
          !Settings.VengPreferFieryBrand || (
            this.getCurrentTarget() && 
            this.getCurrentTarget().hasAuraByMe('Fiery Brand') && 
            this.getRemainingTime(this.getCurrentTarget(), 'Fiery Brand') > 3000
          )),
        
        // Fel Devastation with Fiery Brand synergy
        Spell.cast('Fel Devastation', this.getCurrentTarget, () => 
          this.getFury() >= 50 && (
            !Settings.VengPreferFieryBrand || (
              this.getCurrentTarget() && 
              this.getCurrentTarget().hasAuraByMe('Fiery Brand') && 
              this.getRemainingTime(this.getCurrentTarget(), 'Fiery Brand') > 2000
            )
          )),
        
        // Sigil of Flame
        Spell.cast('Sigil of Flame', this.getCurrentTarget, () => Settings.VengUseSigils),
        
        // Immolation Aura
        Spell.cast('Immolation Aura'),
        
        // Spirit Bomb with enough soul fragments and targets
        Spell.cast('Spirit Bomb', this.getCurrentTarget, () => 
          Settings.VengSpiritBombThreshold > 0 && 
          this.getEnemyCount() >= Settings.VengSpiritBombThreshold),
        
        // Fracture if close to max charges
        Spell.cast('Fracture', this.getCurrentTarget, () => 
          Spell.getCharges('Fracture') > 1.7),
        
        // Felblade for Fury generation
        Spell.cast('Felblade', this.getCurrentTarget, () => 
          this.getFury() < Settings.VengFelbladeThreshold),
        
        // Soul Cleave to spend Fury
        Spell.cast('Soul Cleave', this.getCurrentTarget, () => this.getFury() >= 30),
        
        // Fracture for Soul Fragments and Fury
        Spell.cast('Fracture', this.getCurrentTarget),
        
        // Throw Glaive as filler
        Spell.cast('Throw Glaive', this.getCurrentTarget),
        
        // Regular auto-attacks
        new bt.Action(() => bt.Status.Success)
      )
    );
  }

  // Helper methods
  getCurrentTarget() {
    if (me.targetUnit && me.canAttack(me.targetUnit) && !me.targetUnit.deadOrGhost) {
      return me.targetUnit;
    }
    return combat.bestTarget;
  }

  isAldrachiReaver() {
    return this.hasTalent(VengeanceDemonHunterBehavior.HERO_TALENTS.ALDRACHI_REAVER);
  }

  isFelScarred() {
    return this.hasTalent(VengeanceDemonHunterBehavior.HERO_TALENTS.FEL_SCARRED);
  }

  isDefaultRotation() {
    return true;
  }
  
  // Returns the current hero talent path or null if none is detected
  detectHeroTalent() {
    if (this.hasTalent(VengeanceDemonHunterBehavior.HERO_TALENTS.ALDRACHI_REAVER)) {
      return "Aldrachi Reaver";
    } else if (this.hasTalent(VengeanceDemonHunterBehavior.HERO_TALENTS.FEL_SCARRED)) {
      return "Fel-Scarred";
    } else {
      return null; // No hero talent detected
    }
  }

  hasTalent(talentName) {
    // We check in three different ways to be thorough:
    // 1. Direct spell knowledge check
    // 2. Aura presence check (many talents apply passive auras)
    // 3. Spell book check for abilities granted by talents
    return Spell.isSpellKnown(talentName) || 
           me.hasAura(talentName) ||
           (talentName === VengeanceDemonHunterBehavior.HERO_TALENTS.ALDRACHI_REAVER && 
            Spell.isSpellKnown("Reaver's Glaive")) ||
           (talentName === VengeanceDemonHunterBehavior.HERO_TALENTS.FEL_SCARRED && 
            Spell.isSpellKnown("Demonsurge"));
  }

  getFury() {
    return me.powerByType(PowerType.Fury);
  }

  getSoulFragments() {
    // Soul Fragments are now physical orbs, not an aura
    // We can track them through various game mechanics
    // For gameplay purposes, we can use distance-based detection
    // or infer from related abilities
    
    // Count nearby soul fragments as entities
    const soulFragments = me.getUnitsAroundCount(15).filter(unit => 
      unit.entryId === 177795 || // Soul Fragment entity ID
      unit.name === "Soul Fragment" || 
      unit.name.includes("Soul Fragment")
    ).length;
    
    return soulFragments || 0; // Return 0 if none found
  }

  getArtOfTheGlaiveProc() {
    // Check for Art of the Glaive proc by checking for the specific override ID
    return Spell.getSpell("Throw Glaive").overrideId === 442294;
  }

  getRemainingTime(unit, auraName) {
    if (!unit) return 0;
    const aura = unit.getAuraByMe(auraName);
    return aura ? aura.remaining : 0;
  }

  getEnemyCount() {
    return me.getUnitsAroundCount(8);
  }
}