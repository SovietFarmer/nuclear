import { Behavior, BehaviorContext } from '@/Core/Behavior';
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from '@/Core/Spell';
import Settings from "@/Core/Settings";
import objMgr from "@/Core/ObjectManager";
import CombatTimer from "@/Core/CombatTimer";
import { me } from '@/Core/ObjectManager';
import Pet from "@/Core/Pet";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from '@/Targeting/CombatTargeting';

// STATUS: SUFFICE

// Define auras and spell IDs for easier reference
const auras = {
  nightfall: 264571,
  tormentedCrescendo: 405330,
  seedOfCorruption: 27243,
  demonicCalling: 205146,
  bloodlust: 2825, // Also includes Heroism, Time Warp, etc.
};

const debuffs = {
  agony: 980,
  corruption: 146739,
  unstableAffliction: 316099,
  vileTaint: 278350,
  vileTaintDot: 386997, // For the DoT component
  phantomSingularity: 205179,
  soulRot: 386997,
  shadowEmbrace: 32390,
  haunt: 48181,
  wither: 386922,
  seedOfCorruption: 27243
};

export class AfflictionWarlockBehavior extends Behavior {
  name = 'Affliction Warlock';
  context = BehaviorContext.Any;
  specialization = Specialization.Warlock.Affliction;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: "Cooldowns",
      options: [
        { type: "checkbox", uid: "AffUsePotion", text: "Use Potion", default: false },
        { type: "checkbox", uid: "AffUseTrinkets", text: "Use Trinkets", default: false }
      ]
    },
    {
      header: "AoE Settings",
      options: [
        { type: "slider", uid: "AffAoEThreshold", text: "AoE threshold", min: 2, max: 6, default: 3 }
      ]
    },
    {
      header: "Talent Options",
      options: [
        { type: "checkbox", uid: "AffHasShadowEmbrace", text: "Using Shadow Embrace Talent", default: true },
        { type: "checkbox", uid: "AffHasDemonicSoul", text: "Using Demonic Soul Talent", default: false },
        { type: "checkbox", uid: "AffHasVileTaint", text: "Using Vile Taint Talent", default: true },
        { type: "checkbox", uid: "AffHasPhantomSingularity", text: "Using Phantom Singularity Talent", default: true },
        { type: "checkbox", uid: "AffHasSoulRot", text: "Using Soul Rot Talent", default: true },
        { type: "checkbox", uid: "AffHasWither", text: "Using Wither Talent", default: false },
        { type: "checkbox", uid: "AffHasAbsoluteCorruption", text: "Using Absolute Corruption Talent", default: false },
        { type: "checkbox", uid: "AffHasTormentedCrescendo", text: "Using Tormented Crescendo Talent", default: true },
        { type: "checkbox", uid: "AffHasSummonDarkglare", text: "Using Summon Darkglare Talent", default: true },
        { type: "checkbox", uid: "AffHasSeedOfCorruption", text: "Using Seed of Corruption Talent", default: false },
        { type: "checkbox", uid: "AffHasOblivion", text: "Using Oblivion Talent", default: false }
      ]
    }
  ];

  // Variables from the APL
  cleaveApl = false;
  trinket1Buffs = false;
  trinket2Buffs = false;
  trinket1Exclude = false;
  trinket2Exclude = false;
  trinket1Manual = false;
  trinket2Manual = false;
  trinket1BuffDuration = 0;
  trinket2BuffDuration = 0;
  trinket1Sync = 0.5;
  trinket2Sync = 0.5;
  trinketPriority = 1;
  variablesInitialized = false;
  
  // Additional variables
  psUp = false;
  vtUp = false;
  vtPsUp = false;
  srUp = false;
  cdDotsUp = false;
  hasCds = false;
  cdsActive = false;
  minVt = 0;
  minPs = 0;
  minAgony = 0;
  minPs1 = 0;

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForNotSitting(),
      
      new bt.Action(() => (this.getCurrentTarget() === null ? bt.Status.Success : bt.Status.Failure)),
      common.waitForTarget(),
      common.waitForFacing(),
      common.waitForCastOrChannel(),
      
      // Main rotation logic
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          // Variables calculation first
          this.calculateVariables(),
          
          // Use cleave rotation if multiple targets but less than 3 or if cleaveApl is set
          new bt.Decorator(
            req => (this.getActiveEnemies() !== 1 && this.getActiveEnemies() < Settings.AffAoEThreshold) || this.cleaveApl,
            this.cleaveActions(),
            new bt.Action(() => bt.Status.Success)
          ),
          
          // Use AoE rotation if more than threshold targets
          new bt.Decorator(
            req => this.getActiveEnemies() >= Settings.AffAoEThreshold,
            this.aoeActions(),
            new bt.Action(() => bt.Status.Success)
          ),
          
        //   // Off GCD abilities
          this.ogcdActions(),
          
        //   // Use trinkets
        //   this.useItemsActions(),
          
        //   // Fight end sequence
        //this.endOfFightActions(),
          
          // Single target rotation
          this.singleTargetActions(),
          
          // Default to Shadow Bolt
          spell.cast('Shadow Bolt', this.getCurrentTarget),
          
          // Auto attack as fallback
          spell.cast('Auto Attack', this.getCurrentTarget, req => true)
        )
      )
    );
  }

 

  // Calculate variables and update them
  calculateVariables() {
    return new bt.Action(() => {
      // Initialize variables if not done yet
      if (!this.variablesInitialized) {
        this.cleaveApl = false;
        this.trinket1Buffs = false; // Would be based on trinket.1.has_use_buff|trinket.1.is.funhouse_lens
        this.trinket2Buffs = false; // Would be based on trinket.2.has_use_buff|trinket.2.is.funhouse_lens
        this.trinket1Sync = this.trinket1Buffs ? 1 : 0.5;
        this.trinket2Sync = this.trinket2Buffs ? 1 : 0.5;
        this.trinket1Manual = false; // Would be based on specific trinkets
        this.trinket2Manual = false; // Would be based on specific trinkets
        this.trinket1Exclude = false; // Would be based on specific trinkets
        this.trinket2Exclude = false; // Would be based on specific trinkets
        this.trinket1BuffDuration = 0; // Would be based on trinket proc duration
        this.trinket2BuffDuration = 0; // Would be based on trinket proc duration
        this.trinketPriority = !this.trinket1Buffs && this.trinket2Buffs ? 2 : 1;
        
        this.variablesInitialized = true;
      }
      
      // Update PS status
      this.psUp = !this.hasTalent('Phantom Singularity') || this.getDebuffRemainingTime(debuffs.phantomSingularity) > 0;
      
      // Update VT status
      this.vtUp = !this.hasTalent('Vile Taint') || this.getDebuffRemainingTime(debuffs.vileTaintDot) > 0;
      
      // Update VT and PS combined status
      this.vtPsUp = (!this.hasTalent('Vile Taint') && !this.hasTalent('Phantom Singularity')) ||
                    this.getDebuffRemainingTime(debuffs.vileTaintDot) > 0 ||
                    this.getDebuffRemainingTime(debuffs.phantomSingularity) > 0;
      
      // Update SR status
      this.srUp = !this.hasTalent('Soul Rot') || this.getDebuffRemainingTime(debuffs.soulRot) > 0;
      
      // Update CD dots status
      this.cdDotsUp = this.psUp && this.vtUp && this.srUp;
      
      // Update has CDs status
      this.hasCds = this.hasTalent('Phantom Singularity') || this.hasTalent('Vile Taint') || 
                    this.hasTalent('Soul Rot') || this.hasTalent('Summon Darkglare');
      
      // Update CDs active status
      this.cdsActive = !this.hasCds || (this.cdDotsUp && 
                      (!this.hasTalent('Summon Darkglare') || 
                      spell.getCooldown('Summon Darkglare').timeleft > 20000 || 
                      me.hasPet('Darkglare')));
      
      // For AoE and cleave specific variables
      const targets = combat.targets.filter(unit => common.validTarget(unit) && me.isFacing(unit));
      
      if (targets.length > 1) {
        // Calculate min agony
        this.minAgony = Number.MAX_VALUE;
        targets.forEach(target => {
          const agonyRemains = this.getDebuffRemainingTime(debuffs.agony, target);
          this.minAgony = Math.min(this.minAgony, agonyRemains > 0 ? agonyRemains : 99000);
        });
        
        // Calculate min vile taint
        this.minVt = Number.MAX_VALUE;
        targets.forEach(target => {
          const vtRemains = this.getDebuffRemainingTime(debuffs.vileTaintDot, target);
          this.minVt = Math.min(this.minVt, vtRemains > 0 ? vtRemains : 99000);
        });
        
        // Calculate min phantom singularity
        this.minPs = Number.MAX_VALUE;
        targets.forEach(target => {
          const psRemains = this.getDebuffRemainingTime(debuffs.phantomSingularity, target);
          this.minPs = Math.min(this.minPs, psRemains > 0 ? psRemains : 99000);
        });
        
        // Calculate minPs1
        const vtComponent = this.hasTalent('Vile Taint') ? this.minVt : Number.MAX_VALUE;
        const psComponent = this.hasTalent('Phantom Singularity') ? this.minPs : Number.MAX_VALUE;
        this.minPs1 = Math.min(vtComponent, psComponent);
      }
      
    //   console.log(`Variables: psUp=${this.psUp}, vtUp=${this.vtUp}, vtPsUp=${this.vtPsUp}, srUp=${this.srUp}, cdDotsUp=${this.cdDotsUp}`);
    //   console.log(`Active enemies: ${this.getActiveEnemies()}`);
      
      return bt.Status.Failure; // Continue with the next action
    });
  }
  
  // Single target rotation
  singleTargetActions() {
    return new bt.Selector(
      // Maintain primary DoTs
      spell.cast('Agony', this.getCurrentTarget, req => 
        (!this.hasTalent('Vile Taint') || this.getDebuffRemainingTime(debuffs.agony) < spell.getCooldown('Vile Taint').timeleft + spell.getSpell('Vile Taint').castTime) && 
        (this.hasTalent('Absolute Corruption') && this.getDebuffRemainingTime(debuffs.agony) < 3000 || 
         !this.hasTalent('Absolute Corruption') && this.getDebuffRemainingTime(debuffs.agony) < 5000 || 
         spell.getCooldown('Soul Rot').timeleft < 5000 && this.getDebuffRemainingTime(debuffs.agony) < 8000) && 
        this.getFightRemaining() > this.getDebuffRemainingTime(debuffs.agony) + 5000
      ),
      
      // Haunt with Demonic Soul and Nightfall conditions
      spell.cast('Haunt', this.getCurrentTarget, req => 
        this.hasTalent('Demonic Soul') && me.getAuraStacks(auras.nightfall) < 2 - (this.wasPrevGcd('Drain Soul') ? 1 : 0) && 
        (!this.hasTalent('Vile Taint') || spell.getCooldown('Vile Taint').timeleft > 0)
      ),
      
      // Maintain Unstable Affliction
      spell.cast('Unstable Affliction', this.getCurrentTarget, req => 
        (this.hasTalent('Absolute Corruption') && this.getDebuffRemainingTime(debuffs.unstableAffliction) < 3000 || 
         !this.hasTalent('Absolute Corruption') && this.getDebuffRemainingTime(debuffs.unstableAffliction) < 5000 || 
         spell.getCooldown('Soul Rot').timeleft < 5000 && this.getDebuffRemainingTime(debuffs.unstableAffliction) < 8000) && 
        (!this.hasTalent('Demonic Soul') || me.getAuraStacks(auras.nightfall) < 2 || 
         this.wasPrevGcd('Haunt') && me.getAuraStacks(auras.nightfall) < 2) && 
        this.getFightRemaining() > this.getDebuffRemainingTime(debuffs.unstableAffliction) + 5000
      ),
      
      // Haunt with duration conditions
      spell.cast('Haunt', this.getCurrentTarget, req => 
        (this.hasTalent('Absolute Corruption') && this.getDebuffRemainingTime(debuffs.haunt) < 3000 || 
         !this.hasTalent('Absolute Corruption') && this.getDebuffRemainingTime(debuffs.haunt) < 5000 || 
         spell.getCooldown('Soul Rot').timeleft < 5000 && this.getDebuffRemainingTime(debuffs.haunt) < 8000) && 
        (!this.hasTalent('Vile Taint') || spell.getCooldown('Vile Taint').timeleft > 0) && 
        this.getFightRemaining() > this.getDebuffRemainingTime(debuffs.haunt) + 5000
      ),
      
      // Wither maintenance
      spell.cast('Wither', this.getCurrentTarget, req => 
        this.hasTalent('Wither') && 
        (this.hasTalent('Absolute Corruption') && this.getDebuffRemainingTime(debuffs.wither) < 3000 || 
         !this.hasTalent('Absolute Corruption') && this.getDebuffRemainingTime(debuffs.wither) < 5000) && 
        this.getFightRemaining() > this.getDebuffRemainingTime(debuffs.wither) + 5000
      ),
      
      // Corruption maintenance
      spell.cast('Corruption', this.getCurrentTarget, req => 
        this.getDebuffRemainingTime(debuffs.corruption) < this.getGcdMax() && 
        this.getFightRemaining() > this.getDebuffRemainingTime(debuffs.corruption) + 5000
      ),
      
      // Drain Soul with Nightfall - high priority cases
      spell.cast('Drain Soul', this.getCurrentTarget, req => 
        me.hasAura(auras.nightfall) && 
        (me.getAuraStacks(auras.nightfall) > 1 || this.getAuraRemainingTime(auras.nightfall) < spell.getSpell('Drain Soul').castTime * 2) && 
        !me.hasAura(auras.tormentedCrescendo) && 
        spell.getCooldown('Soul Rot').timeleft > 0 && 
        this.getSoulShards() < 5 - me.getAuraStacks(auras.tormentedCrescendo) && 
        (!this.hasTalent('Vile Taint') || spell.getCooldown('Vile Taint').timeleft > 0)
      ),
      
      // Shadow Bolt with Nightfall - high priority cases
      spell.cast('Shadow Bolt', this.getCurrentTarget, req => 
        me.hasAura(auras.nightfall) && 
        (me.getAuraStacks(auras.nightfall) > 1 || this.getAuraRemainingTime(auras.nightfall) < spell.getSpell('Shadow Bolt').castTime * 2) && 
        me.getAuraStacks(auras.tormentedCrescendo) < 2 && 
        spell.getCooldown('Soul Rot').timeleft > 0 && 
        this.getSoulShards() < 5 - me.getAuraStacks(auras.tormentedCrescendo) && 
        (!this.hasTalent('Vile Taint') || spell.getCooldown('Vile Taint').timeleft > 0)
      ),
      
      // Shadow Embrace maintenance if using Wither
      new bt.Decorator(
        req => this.hasTalent('Wither'),
        this.seMaintenance(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Vile Taint
      spell.cast('Vile Taint', this.getCurrentTarget, req => me.hasAura(auras.vileTaint) &&
        (!this.hasTalent('Soul Rot') || spell.getCooldown('Soul Rot').timeleft > 20000 || 
         spell.getCooldown('Soul Rot').timeleft <= spell.getSpell('Vile Taint').castTime + this.getGcdMax() || 
         this.getFightRemaining() < spell.getCooldown('Soul Rot').timeleft) && 
        this.getDebuffRemainingTime(debuffs.agony) > 0 && 
        (this.getDebuffRemainingTime(debuffs.corruption) > 0 || this.getDebuffRemainingTime(debuffs.wither) > 0) && 
        this.getDebuffRemainingTime(debuffs.unstableAffliction) > 0
      ),
      
      // Phantom Singularity
      spell.cast('Phantom Singularity', this.getCurrentTarget, req => 
        (!this.hasTalent('Soul Rot') || spell.getCooldown('Soul Rot').timeleft < 4000 || 
         this.getFightRemaining() < spell.getCooldown('Soul Rot').timeleft) && 
        this.getDebuffRemainingTime(debuffs.agony) > 0 && 
        (this.getDebuffRemainingTime(debuffs.corruption) > 0 || this.getDebuffRemainingTime(debuffs.wither) > 0) && 
        this.getDebuffRemainingTime(debuffs.unstableAffliction) > 0
      ),
      
      // Malevolence (placeholder until proper ID is found)
      spell.cast('Malevolence', this.getCurrentTarget, req => this.vtPsUp),
      
      // Soul Rot
      spell.cast('Soul Rot', this.getCurrentTarget, req => this.vtPsUp),
      
      // Summon Darkglare
      spell.cast('Summon Darkglare', this.getCurrentTarget, req => 
        this.cdDotsUp && (this.getShadowEmbraceStack() === this.getMaxShadowEmbraceStack())
      ),
      
      // Shadow Embrace maintenance if using Demonic Soul
      new bt.Decorator(
        req => this.hasTalent('Demonic Soul'),
        this.seMaintenance(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Malefic Rapture high soul shard or high Tormented Crescendo
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.getSoulShards() > 4 && (this.hasTalent('Demonic Soul') && me.getAuraStacks(auras.nightfall) < 2 || 
        !this.hasTalent('Demonic Soul')) || me.getAuraStacks(auras.tormentedCrescendo) > 1
      ),
      
      // Drain Soul with Nightfall, Tormented Crescendo, and target below 20%
      spell.cast('Drain Soul', this.getCurrentTarget, req => 
        this.hasTalent('Demonic Soul') && me.hasAura(auras.nightfall) && 
        me.getAuraStacks(auras.tormentedCrescendo) < 2 && this.getCurrentTarget().healthPercent < 20
      ),
      
      // Malefic Rapture for Demonic Soul
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.hasTalent('Demonic Soul') && 
        (this.getSoulShards() > 1 || me.hasAura(auras.tormentedCrescendo) && 
         spell.getCooldown('Soul Rot').timeleft > this.getAuraRemainingTime(auras.tormentedCrescendo) * this.getGcdMax()) && 
        (!this.hasTalent('Vile Taint') || this.getSoulShards() > 1 && spell.getCooldown('Vile Taint').timeleft > 10000) && 
        (!this.hasTalent('Oblivion') || spell.getCooldown('Oblivion').timeleft > 10000 || 
         this.getSoulShards() > 2 && spell.getCooldown('Oblivion').timeleft < 10000)
      ),
      
      // Oblivion
      spell.cast('Oblivion', this.getCurrentTarget, req => 
        this.getDebuffRemainingTime(debuffs.agony) > 0 && 
        (this.getDebuffRemainingTime(debuffs.corruption) > 0 || this.getDebuffRemainingTime(debuffs.wither) > 0) && 
        this.getDebuffRemainingTime(debuffs.unstableAffliction) > 0 && 
        this.getDebuffRemainingTime(debuffs.haunt) > 5000
      ),
      
      // Malefic Rapture with Tormented Crescendo
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.hasTalent('Tormented Crescendo') && me.hasAura(auras.tormentedCrescendo) && 
        (this.getAuraRemainingTime(auras.tormentedCrescendo) < this.getGcdMax() * 2 || 
         me.getAuraStacks(auras.tormentedCrescendo) === 2)
      ),
      
      // Malefic Rapture with CDs up
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        (this.cdDotsUp || 
         (this.hasTalent('Demonic Soul') || this.hasTalent('Phantom Singularity')) && this.vtPsUp || 
         this.hasTalent('Wither') && this.vtPsUp && !this.getDebuffRemainingTime(debuffs.soulRot) && this.getSoulShards() > 2) && 
        (!this.hasTalent('Oblivion') || spell.getCooldown('Oblivion').timeleft > 10000 || 
         this.getSoulShards() > 2 && spell.getCooldown('Oblivion').timeleft < 10000)
      ),
      
      // Malefic Rapture for Tormented Crescendo, Nightfall, and Demonic Soul
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.hasTalent('Tormented Crescendo') && this.hasTalent('Nightfall') && 
        me.hasAura(auras.tormentedCrescendo) && me.hasAura(auras.nightfall) || 
        this.hasTalent('Demonic Soul') && !me.hasAura(auras.nightfall) && 
        (!this.hasTalent('Vile Taint') || spell.getCooldown('Vile Taint').timeleft > 10000 || 
         this.getSoulShards() > 1 && spell.getCooldown('Vile Taint').timeleft < 10000)
      ),
      
      // Malefic Rapture without Demonic Soul but with Tormented Crescendo
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        !this.hasTalent('Demonic Soul') && me.hasAura(auras.tormentedCrescendo)
      ),
      
      // Drain Soul with Nightfall
      spell.cast('Drain Soul', this.getCurrentTarget, req => me.hasAura(auras.nightfall)),
      
      // Shadow Bolt with Nightfall
      spell.cast('Shadow Bolt', this.getCurrentTarget, req => me.hasAura(auras.nightfall)),
      
      // Refresh Agony
      spell.cast('Agony', this.getCurrentTarget, req => this.getDebuffRemainingTime(debuffs.agony) < this.getGcdMax()),
      
      // Refresh Unstable Affliction
      spell.cast('Unstable Affliction', this.getCurrentTarget, req => this.getDebuffRemainingTime(debuffs.unstableAffliction) < this.getGcdMax()),
      
      // Drain Soul as filler
      spell.cast('Drain Soul', this.getCurrentTarget, req => true, success => {
        // Used to set up early chain if Nightfall procs
        return true;
      }, { interrupt: true, interruptIf: "tick_time>0.5" }),
      
      // Shadow Bolt as filler
      spell.cast('Shadow Bolt', this.getCurrentTarget)
    );
  }
  
  // AoE rotation
  aoeActions() {
    return new bt.Selector(
      // Off GCD abilities
      this.ogcdActions(),
      
      // Trinkets and items
      this.useItemsActions(),
      
      // Haunt for AoE
      spell.cast('Haunt', this.getCurrentTarget, req => this.getDebuffRemainingTime(debuffs.haunt) < 3000),
      
      // Vile Taint for AoE
      spell.cast('Vile Taint', this.getCurrentTarget, req => me.hasAura(auras.vileTaint) &&
        spell.getCooldown('Soul Rot').timeleft <= spell.getSpell('Vile Taint').castTime || 
        spell.getCooldown('Soul Rot').timeleft >= 25000
      ),
      
      // Phantom Singularity for AoE
      spell.cast('Phantom Singularity', this.getCurrentTarget, req => me.hasAura('Soul Rot') &&
        (spell.getCooldown('Soul Rot').timeleft <= spell.getSpell('Phantom Singularity').castTime || 
         spell.getCooldown('Soul Rot').timeleft >= 25000) && 
        this.getDebuffRemainingTime(debuffs.agony) > 0
      ),
      
      // Unstable Affliction in AoE
      spell.cast('Unstable Affliction', this.getCurrentTarget, req => this.getDebuffRemainingTime(debuffs.unstableAffliction) < 5000),
      
      // Agony in AoE - apply to multiple targets
      spell.cast('Agony', this.getAgonyTarget, req => me.hasAura(auras.vileTaint) &&
        this.getActiveDotsCount(debuffs.agony) < 8 && 
        (this.getDebuffRemainingTime(debuffs.agony, (this.getAgonyTarget >= 0 ? this.getAgonyTarget : this.getCurrentTarget)) < 
         spell.getCooldown('Vile Taint').timeleft + spell.getSpell('Vile Taint').castTime || 
         !this.hasTalent('Vile Taint')) && 
        this.getGcdMax() + spell.getSpell('Soul Rot').castTime + this.getGcdMax() < this.minPs1 && 
        this.getDebuffRemainingTime(debuffs.agony, (this.getAgonyTarget >= 0 ? this.getAgonyTarget : this.getCurrentTarget)) < 10000
      ),
      
      // Soul Rot for AoE
      spell.cast('Soul Rot', this.getCurrentTarget, req => 
        this.vtUp && (this.psUp || this.vtUp) && this.getDebuffRemainingTime(debuffs.agony) > 0
      ),
      
      // Malevolence for AoE
      spell.cast('Malevolence', this.getCurrentTarget, req => 
        this.psUp && this.vtUp && this.srUp
      ),
      
      // Seed of Corruption for AoE
      spell.cast('Seed of Corruption', (this.getSeedTarget >= 0 ? this.getSeedTarget : this.getCurrentTarget), req => 
        ((!this.hasTalent('Wither')) || 
         (this.hasTalent('Wither') && this.getDebuffRemainingTime(debuffs.wither, (this.getSeedTarget >= 0 ? this.getSeedTarget : this.getCurrentTarget)) < 5000)) && 
        !this.hasDebuff(debuffs.seedOfCorruption, (this.getSeedTarget >= 0 ? this.getSeedTarget : this.getCurrentTarget))
      ),
      
      // Corruption for AoE targets without Seed of Corruption
      spell.cast('Corruption', this.getCorruptionTarget, req =>  
        !this.hasTalent('Seed of Corruption')
      ),
      
      // Wither for AoE targets without Seed of Corruption
      spell.cast('Wither', this.getWitherTarget, req => 
        this.getDebuffRemainingTime(debuffs.wither, (this.getWitherTarget >= 0 ? this.getWitherTarget : this.getCurrentTarget)) < 5000 && 
        !this.hasTalent('Seed of Corruption')
      ),
      
      // Summon Darkglare for AoE
      spell.cast('Summon Darkglare', this.getCurrentTarget, req => 
        this.psUp && this.vtUp && this.srUp
      ),
      
      // Malefic Rapture with Tormented Crescendo
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        (spell.getCooldown('Summon Darkglare').timeleft > 15000 || this.getSoulShards() > 3 || 
         (this.hasTalent('Demonic Soul') && this.getSoulShards() > 2)) && 
        me.hasAura(auras.tormentedCrescendo)
      ),
      
      // Malefic Rapture with high soul shards
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.getSoulShards() > 4 || 
        (this.hasTalent('Tormented Crescendo') && me.getAuraStacks(auras.tormentedCrescendo) === 1 && this.getSoulShards() > 3)
      ),
      
      // Malefic Rapture for Demonic Soul
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.hasTalent('Demonic Soul') && 
        (this.getSoulShards() > 2 || 
         (this.hasTalent('Tormented Crescendo') && me.getAuraStacks(auras.tormentedCrescendo) === 1 && this.getSoulShards()))
      ),
      
      // Malefic Rapture with Tormented Crescendo
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.hasTalent('Tormented Crescendo') && me.hasAura(auras.tormentedCrescendo)
      ),
      
      // Malefic Rapture with 2 stacks of Tormented Crescendo
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.hasTalent('Tormented Crescendo') && me.getAuraStacks(auras.tormentedCrescendo) === 2
      ),
      
      // Malefic Rapture with CDs up
      spell.cast('Malefic Rapture', this.getCurrentTarget, req =>  me.hasAura('Malefic Rapture') &&
        (this.cdDotsUp || this.vtPsUp) && 
        (this.getSoulShards() > 2 || spell.getCooldown('Oblivion').timeleft > 10000 || !this.hasTalent('Oblivion'))
      ),
      
      // Malefic Rapture with Tormented Crescendo and Nightfall
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.hasTalent('Tormented Crescendo') && this.hasTalent('Nightfall') && 
        me.hasAura(auras.tormentedCrescendo) && me.hasAura(auras.nightfall)
      ),
      
      // Drain Soul with Nightfall for Shadow Embrace
      spell.cast('Drain Soul', this.getCurrentTarget, req => 
        me.hasAura(auras.nightfall) && this.hasTalent('Shadow Embrace') && 
        (this.getShadowEmbraceStack() < 4 || this.getDebuffRemainingTime(debuffs.shadowEmbrace) < 3000),
        { interrupt: true, interruptIf: "cooldown.vile_taint.ready" }
      ),
      
      // Drain Soul for Shadow Embrace
      spell.cast('Drain Soul', this.getCurrentTarget, req => 
        this.hasTalent('Shadow Embrace') && 
        (this.getShadowEmbraceStack() < 4 || this.getDebuffRemainingTime(debuffs.shadowEmbrace) < 3000) || 
        !this.hasTalent('Shadow Embrace'),
        { interrupt: true, interruptIf: "cooldown.vile_taint.ready", interruptGlobal: true }
      ),
      
      // Shadow Bolt with Nightfall for Shadow Embrace
      spell.cast('Shadow Bolt', this.getCurrentTarget, req => 
        me.hasAura(auras.nightfall) && this.hasTalent('Shadow Embrace') && 
        (this.getShadowEmbraceStack() < 2 || this.getDebuffRemainingTime(debuffs.shadowEmbrace) < 3000)
      )
    );
  }
  
  // Cleave rotation (2 target)
  cleaveActions() {
    return new bt.Selector(
      // Off GCD abilities
      this.ogcdActions(),
      
      // Use trinkets
      this.useItemsActions(),
      
      // Fight end sequence
      this.endOfFightActions(),
      
      // Agony cleave - minimize remaining time
      spell.cast('Agony', (this.getAgonyTarget != null ? this.getAgonyTarget : this.getCurrentTarget), req => 
        (this.getDebuffRemainingTime(debuffs.agony, this.getAgonyTarget()) < 
         spell.getCooldown('Vile Taint').timeleft + spell.getSpell('Vile Taint').castTime || 
         !this.hasTalent('Vile Taint')) && 
        (this.getDebuffRemainingTime(debuffs.agony, this.getAgonyTarget()) < this.getGcdMax() * 2 || 
         this.hasTalent('Demonic Soul') && 
         this.getDebuffRemainingTime(debuffs.agony, this.getAgonyTarget()) < spell.getCooldown('Soul Rot').timeleft + 8000 && 
         spell.getCooldown('Soul Rot').timeleft < 5000) && 
        this.getFightRemaining() > this.getDebuffRemainingTime(debuffs.agony, (this.getAgonyTarget >= 0 ? this.getAgonyTarget : this.getCurrentTarget)) + 5000
      ),
      
      // Wither cleave - minimize remaining time
      spell.cast('Wither', (this.getWitherTarget != null ? this.getWitherTarget : this.getCurrentTarget), req => 
        this.getDebuffRemainingTime(debuffs.wither, (this.getWitherTarget >= 0 ? this.getWitherTarget : this.getCurrentTarget)) < 5000 && 
        
        !this.hasDebuff(debuffs.seedOfCorruption, (this.getWitherTarget >= 0 ? this.getWitherTarget : this.getCurrentTarget)) && 
        this.getFightRemaining() > this.getDebuffRemainingTime(debuffs.wither, (this.getWitherTarget >= 0 ? this.getWitherTarget : this.getCurrentTarget)) + 5000
      ),
      
      // Haunt for Demonic Soul or low remaining time
      spell.cast('Haunt', this.getCurrentTarget, req => 
        this.hasTalent('Demonic Soul') && me.getAuraStacks(auras.nightfall) < 2 - (this.wasPrevGcd('Drain Soul') ? 1 : 0) && 
        (!this.hasTalent('Vile Taint') || spell.getCooldown('Vile Taint').timeleft > 0) || 
        this.getDebuffRemainingTime(debuffs.haunt) < 3000
      ),
      
      // Unstable Affliction cleave
      spell.cast('Unstable Affliction', this.getCurrentTarget, req => 
        (this.getDebuffRemainingTime(debuffs.unstableAffliction) < 5000 || 
         this.hasTalent('Demonic Soul') && 
         this.getDebuffRemainingTime(debuffs.unstableAffliction) < spell.getCooldown('Soul Rot').timeleft + 8000 && 
         spell.getCooldown('Soul Rot').timeleft < 5000) && 
        this.getFightRemaining() > this.getDebuffRemainingTime(debuffs.unstableAffliction) + 5000
      ),
      
      // Corruption cleave - minimize remaining time
      spell.cast('Corruption', (this.getCorruptionTarget != null ? this.getCorruptionTarget : this.getCorruptionTarget), req => 
        this.getDebuffRemainingTime(debuffs.corruption, (this.getCorruptionTarget >= 0 ? this.getCorruptionTarget : this.getCurrentTarget)) < 5000 && 
        !this.hasDebuff(debuffs.seedOfCorruption, this.getCorruptionTarget()) && 
        this.getFightRemaining() > this.getDebuffRemainingTime(debuffs.corruption, (this.getCorruptionTarget >= 0 ? this.getCorruptionTarget : this.getCurrentTarget)) + 5000
      ),
      
      // Shadow Embrace maintenance for Wither
      new bt.Decorator(
        req => this.hasTalent('Wither'),
        this.cleaveSeMaintenance(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Vile Taint cleave
      spell.cast('Vile Taint', this.getCurrentTarget, req => 
        !this.hasTalent('Soul Rot') || 
        (this.minAgony < 1500 || spell.getCooldown('Soul Rot').timeleft <= spell.getSpell('Vile Taint').castTime + this.getGcdMax()) || 
        spell.getCooldown('Soul Rot').timeleft >= 20000
      ),
      
      // Phantom Singularity cleave
      spell.cast('Phantom Singularity', this.getCurrentTarget, req => 
        (!this.hasTalent('Soul Rot') || 
         spell.getCooldown('Soul Rot').timeleft < 4000 || 
         this.getFightRemaining() < spell.getCooldown('Soul Rot').timeleft) && 
        this.getActiveDotsCount(debuffs.agony) === 2
      ),
      
      // Malevolence cleave
      spell.cast('Malevolence', this.getCurrentTarget, req => this.vtPsUp),
      
      // Soul Rot cleave
      spell.cast('Soul Rot', this.getCurrentTarget, req => 
        this.vtPsUp && this.getActiveDotsCount(debuffs.agony) === 2
      ),
      
      // Summon Darkglare cleave
      spell.cast('Summon Darkglare', this.getCurrentTarget, req => this.cdDotsUp),
      
      // Opener with Shadow Embrace in cleave
      new bt.Decorator(
        req => this.hasTalent('Demonic Soul'),
        this.openerCleaveSe(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Shadow Embrace maintenance for Demonic Soul
      new bt.Decorator(
        req => this.hasTalent('Demonic Soul'),
        this.cleaveSeMaintenance(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Rest of cleave rotation largely mirrors single target from here
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.getSoulShards() > 4 && 
        (this.hasTalent('Demonic Soul') && me.getAuraStacks(auras.nightfall) < 2 || !this.hasTalent('Demonic Soul')) || 
        me.getAuraStacks(auras.tormentedCrescendo) > 1
      ),
      
      spell.cast('Drain Soul', this.getCurrentTarget, req => 
        this.hasTalent('Demonic Soul') && me.hasAura(auras.nightfall) && 
        me.getAuraStacks(auras.tormentedCrescendo) < 2 && this.getCurrentTarget().healthPercent < 20
      ),
      
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.hasTalent('Demonic Soul') && 
        (this.getSoulShards() > 1 || 
         me.hasAura(auras.tormentedCrescendo) && 
         spell.getCooldown('Soul Rot').timeleft > this.getAuraRemainingTime(auras.tormentedCrescendo) * this.getGcdMax()) && 
        (!this.hasTalent('Vile Taint') || 
         this.getSoulShards() > 1 && spell.getCooldown('Vile Taint').timeleft > 10000) && 
        (!this.hasTalent('Oblivion') || 
         spell.getCooldown('Oblivion').timeleft > 10000 || 
         this.getSoulShards() > 2 && spell.getCooldown('Oblivion').timeleft < 10000)
      ),
      
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.hasTalent('Tormented Crescendo') && me.hasAura(auras.tormentedCrescendo) && 
        (this.getAuraRemainingTime(auras.tormentedCrescendo) < this.getGcdMax() * 2 || 
         me.getAuraStacks(auras.tormentedCrescendo) === 2)
      ),
      
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        (this.cdDotsUp || 
         (this.hasTalent('Demonic Soul') || this.hasTalent('Phantom Singularity')) && this.vtPsUp || 
         this.hasTalent('Wither') && this.vtPsUp && !this.getDebuffRemainingTime(debuffs.soulRot) && this.getSoulShards() > 1) && 
        (!this.hasTalent('Oblivion') || 
         spell.getCooldown('Oblivion').timeleft > 10000 || 
         this.getSoulShards() > 2 && spell.getCooldown('Oblivion').timeleft < 10000)
      ),
      
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.hasTalent('Tormented Crescendo') && this.hasTalent('Nightfall') && 
        me.hasAura(auras.tormentedCrescendo) && me.hasAura(auras.nightfall) || 
        this.hasTalent('Demonic Soul') && !me.hasAura(auras.nightfall) && 
        (!this.hasTalent('Vile Taint') || 
         spell.getCooldown('Vile Taint').timeleft > 10000 || 
         this.getSoulShards() > 1 && spell.getCooldown('Vile Taint').timeleft < 10000)
      ),
      
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        !this.hasTalent('Demonic Soul') && me.hasAura(auras.tormentedCrescendo)
      ),
      
      // Refresh Agony in cleave
      spell.cast('Agony', this.getCurrentTarget, req => 
        this.getDebuffRemainingTime(debuffs.agony) < this.getGcdMax() || 
        spell.getCooldown('Soul Rot').timeleft < 5000 && this.getDebuffRemainingTime(debuffs.agony) < 8000
      ),
      
      // Refresh Unstable Affliction in cleave
      spell.cast('Unstable Affliction', this.getCurrentTarget, req => 
        this.getDebuffRemainingTime(debuffs.unstableAffliction) < this.getGcdMax() || 
        spell.getCooldown('Soul Rot').timeleft < 5000 && this.getDebuffRemainingTime(debuffs.unstableAffliction) < 8000
      ),
      
      // Nightfall procs
      spell.cast('Drain Soul', this.getCurrentTarget, req => me.hasAura(auras.nightfall)),
      spell.cast('Shadow Bolt', this.getCurrentTarget, req => me.hasAura(auras.nightfall)),
      
      // Refresh Wither in cleave
      spell.cast('Wither', this.getCurrentTarget, req => this.getDebuffRemainingTime(debuffs.wither) < this.getGcdMax()),
      
      // Refresh Corruption in cleave
      spell.cast('Corruption', this.getCurrentTarget, req => this.getDebuffRemainingTime(debuffs.corruption) < this.getGcdMax()),
      
      // Drain Soul filler for cleave
      spell.cast('Drain Soul', this.getCurrentTarget, req => true, success => {
        // Used to set up early chain if Nightfall procs
        return true;
      }, { interrupt: true, interruptIf: "tick_time>0.5" }),
      
      // Shadow Bolt filler for cleave
      spell.cast('Shadow Bolt', this.getCurrentTarget)
    );
  }
  
  // Shadow Embrace maintenance for single target
  seMaintenance() {
    return new bt.Selector(
      spell.cast('Drain Soul', this.getCurrentTarget, req => 
        this.hasTalent('Shadow Embrace') && this.hasTalent('Drain Soul') && 
        (this.getShadowEmbraceStack() < this.getMaxShadowEmbraceStack() || 
         this.getDebuffRemainingTime(debuffs.shadowEmbrace) < 3000) && 
        this.getActiveEnemies() <= 4 && this.getFightRemaining() > 15000,
        { interrupt: true, interruptIf: "debuff.shadow_embrace.stack=debuff.shadow_embrace.max_stack" }
      ),
      
      spell.cast('Shadow Bolt', this.getCurrentTarget, req => 
        this.hasTalent('Shadow Embrace') && 
        ((this.getShadowEmbraceStack() + this.getInFlightShadowBolts()) < this.getMaxShadowEmbraceStack() || 
         this.getDebuffRemainingTime(debuffs.shadowEmbrace) < 3000 && this.getInFlightShadowBolts() === 0) && 
        this.getActiveEnemies() <= 4 && this.getFightRemaining() > 15000
      )
    );
  }
  
  // Shadow Embrace maintenance for cleave
  cleaveSeMaintenance() {
    return new bt.Selector(
      spell.cast('Drain Soul', this.getCurrentTarget, req => 
        this.hasTalent('Shadow Embrace') && this.hasTalent('Drain Soul') && 
        (this.hasTalent('Wither') || this.hasTalent('Demonic Soul') && me.hasAura(auras.nightfall)) && 
        (this.getShadowEmbraceStack() < this.getMaxShadowEmbraceStack() || 
         this.getDebuffRemainingTime(debuffs.shadowEmbrace) < 3000) && 
        this.getFightRemaining() > 15000,
        { interrupt: true, interruptIf: "debuff.shadow_embrace.stack>3" }
      ),
      
      spell.cast('Shadow Bolt', this.getCurrentTarget, req => 
        this.hasTalent('Shadow Embrace') && !this.hasTalent('Drain Soul') && 
        ((this.getShadowEmbraceStack() + this.getInFlightShadowBolts()) < this.getMaxShadowEmbraceStack() || 
         this.getDebuffRemainingTime(debuffs.shadowEmbrace) < 3000 && this.getInFlightShadowBolts() === 0) && 
        this.getFightRemaining() > 15000
      )
    );
  }
  
  // Opener with Shadow Embrace in cleave
  openerCleaveSe() {
    return new bt.Selector(
      spell.cast('Drain Soul', this.getCurrentTarget, req => 
        this.hasTalent('Shadow Embrace') && this.hasTalent('Drain Soul') && 
        me.hasAura(auras.nightfall) && 
        (this.getShadowEmbraceStack() < this.getMaxShadowEmbraceStack() || 
         this.getDebuffRemainingTime(debuffs.shadowEmbrace) < 3000) && 
        (this.getFightRemaining() > 15000 || this.getTimePassed() < 20000),
        { interrupt: true, interruptIf: "debuff.shadow_embrace.stack=debuff.shadow_embrace.max_stack" }
      )
    );
  }
  
  // Off-GCD abilities
  ogcdActions() {
    return new bt.Selector(
      // Use potion
      new bt.Action(() => {
        if (Settings.AffUsePotion && (this.cdsActive || this.getFightRemaining() < 32000 || 
            this.wasPrevGcd('Soul Rot') && this.getTimePassed() < 20000)) {
          // Potion usage logic would go here
          // Since there's no direct way to use potions in this framework, this is a placeholder
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      
      // Racial abilities
      spell.cast('Berserking', req => this.cdsActive || this.getFightRemaining() < 14000 || this.wasPrevGcd('Soul Rot') && this.getTimePassed() < 20000),
      
      spell.cast('Blood Fury', req => this.cdsActive || this.getFightRemaining() < 17000 || this.wasPrevGcd('Soul Rot') && this.getTimePassed() < 20000),
      
      spell.cast('Fireblood', req => this.cdsActive || this.getFightRemaining() < 10000 || this.wasPrevGcd('Soul Rot') && this.getTimePassed() < 20000),
      
      spell.cast('Ancestral Call', req => this.cdsActive || this.getFightRemaining() < 17000 || this.wasPrevGcd('Soul Rot') && this.getTimePassed() < 20000)
    );
  }
  
  // Items and trinkets
  useItemsActions() {
    return new bt.Action(() => {
      if (!Settings.AffUseTrinkets) {
        return bt.Status.Failure;
      }
      
      // Here you would implement the complex trinket logic from the APL
      // This is a simplified placeholder
      return bt.Status.Failure;
    });
  }
  
  // End of fight optimizations
  endOfFightActions() {
    return new bt.Selector(
      spell.cast('Drain Soul', this.getCurrentTarget, req => 
        this.hasTalent('Demonic Soul') && 
        (this.getFightRemaining() < 5000 && me.hasAura(auras.nightfall) || 
         this.wasPrevGcd('Haunt') && me.getAuraStacks(auras.nightfall) === 2 && !me.hasAura(auras.tormentedCrescendo))
      ),
      
      spell.cast('Oblivion', this.getCurrentTarget, req => 
        this.getSoulShards() > 1 && me.hasAura('Oblivion') &&
        this.getFightRemaining() < (this.getSoulShards() + me.getAuraStacks(auras.tormentedCrescendo)) * this.getGcdMax() + spell.getSpell('Oblivion').castTime
      ),
      
      spell.cast('Malefic Rapture', this.getCurrentTarget, req => 
        this.getFightRemaining() < 4000 && 
        (!this.hasTalent('Demonic Soul') || 
         this.hasTalent('Demonic Soul') && me.getAuraStacks(auras.nightfall) < 1)
      )
    );
  }
  
  // Helper to get current target
  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

    // Helper function to get the target for Agony applications
    // Helper function to get the target for Agony applications
  getAgonyTarget() {
    // Get all valid targets
    const targets = combat.targets.filter(unit => common.validTarget(unit) && me.isFacing(unit));
    
    // Find the target with the lowest Agony remaining time
    let minAgonyTarget = null;
    let minAgonyTime = Number.MAX_VALUE;
    
    targets.forEach(target => {
      const agonyRemains = this.getDebuffRemainingTime(debuffs.agony, target);
      if (agonyRemains < minAgonyTime) {
        minAgonyTime = agonyRemains;
        minAgonyTarget = target;
      }
    });
    
    return minAgonyTarget || null;
  }

    // Helper function to get the target for Corruption applications
    getCorruptionTarget() {
    // Get all valid targets
    const targets = combat.targets.filter(unit => common.validTarget(unit) && me.isFacing(unit));

    // Find the target with the lowest Corruption remaining time
    let minCorruptionTarget = null;
    let minCorruptionTime = Number.MAX_VALUE;

    targets.forEach(target => {
        const corruptionRemains = this.getDebuffRemainingTime(debuffs.corruption, target);
        if (corruptionRemains < minCorruptionTime) {
        minCorruptionTime = corruptionRemains;
        minCorruptionTarget = target;
        }
    });

    return minCorruptionTarget || null;
    }

    // Helper function to get the target for Wither applications
    getWitherTarget() {
    // Get all valid targets
    const targets = combat.targets.filter(unit => common.validTarget(unit) && me.isFacing(unit));

    // Find the target with the lowest Wither remaining time
    let minWitherTarget = null;
    let minWitherTime = Number.MAX_VALUE;

    targets.forEach(target => {
        const witherRemains = this.getDebuffRemainingTime(debuffs.wither, target);
        if (witherRemains < minWitherTime) {
        minWitherTime = witherRemains;
        minWitherTarget = target;
        }
    });

    return minWitherTarget || null;
    }

    // Helper function to get the target for Seed of Corruption
    getSeedTarget() {
    // Get all valid targets
    const targets = combat.targets.filter(unit => common.validTarget(unit) && me.isFacing(unit));

    // Find the target with the lowest Corruption/Wither remaining time
    let seedTarget = null;
    let minTime = Number.MAX_VALUE;

    targets.forEach(target => {
        const debuffRemains = this.hasTalent('Wither') ? 
                            this.getDebuffRemainingTime(debuffs.wither, target) : 
                            this.getDebuffRemainingTime(debuffs.corruption, target);
        
        if (debuffRemains < minTime) {
        minTime = debuffRemains;
        seedTarget = target;
        }
    });

    return seedTarget || null;
    }

    // Helper methods
    hasTalent(talentName) {
    
            return me.hasAura(talentName);
    
    }

    wasPrevGcd(spellName, position = 1) {
    // Get the recent spell history with timestamps
    const spellHistory = spell.getLastSuccessfulSpells(10, true);

    // Validate position parameter
    if (position < 1 || position > spellHistory.length) {
        return false;
    }

    // Calculate the position from the end (most recent spells are at the end)
    const index = spellHistory.length - position;

    // Get the spell at the requested position
    const targetSpell = spellHistory[index];

    // If there's no spell at that position, return false
    if (!targetSpell) {
        return false;
    }

    // Check if the spell name matches (case-insensitive comparison)
    const spellMatches = targetSpell.spellName.toLowerCase() === spellName.toString().toLowerCase();

    return spellMatches;
    }
  
    getGcdMax() {
    // Get the base GCD value (usually 1.5s without haste)
    return 1500 / (1 + (me.modSpellHaste / 100));
    }

    getTimePassed() {
    // Time since combat started in milliseconds
    return CombatTimer.getCombatTime();
    }

    getActiveEnemies(range = 10) {
    return me.targetUnit.getUnitsAroundCount(range);
    }

    getFightRemaining() {
    const target = this.getCurrentTarget();
    //return target ? target.timeToDeath() : 0;
    return 500000; // Default to a large value for simplicity
    }

    getDebuffRemainingTime(debuffId, target = null) {
    target = target || this.getCurrentTarget();
    if (!target) return 0;

    const debuff = this.hasDebuff(debuffId);
    return debuff ? debuff.timeleft : 0;
    }

    getShadowEmbraceStack(target = null) {
    target = target || this.getCurrentTarget();
    if (!target) return 0;

    const se = target.getAura(debuffs.shadowEmbrace);
    return se ? se.stacks : 0;
    }

    getMaxShadowEmbraceStack() {
    return 4; // Assuming 4 is max stack for Shadow Embrace
    }

    getSoulShards() {
    return me.powerByType(PowerType.SoulShards);
    }

    getActiveDotsCount(dotId) {
    return combat.targets.filter(unit => 
        common.validTarget(unit) && this.hasDebuff(dotId, unit)
    ).length;
    }

    hasDebuff(debuffId, target = null) {
        target = me.target || this.getCurrentTarget();
        if (!target) return false;

    return target.hasAura(debuffId) ? true : false;
    }

    getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
    }

    getInFlightShadowBolts(target = null) {
    target = target || this.getCurrentTarget();
    if (!target) return 0;

    // This is a simplified approach
    return 0;
    }
}