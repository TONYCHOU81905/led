import { create } from 'zustand'
import type { LedProject, RoleDefinition, TimelineEventUI } from '../shared/types/project'
import { repairProjectTimelineEvents } from '../shared/eventTimeRepair'
import { migrateProjectToFiveOutputs } from '../shared/ledOutputMigration'
import {
  addEvent,
  addRole,
  createDefaultShowProject,
  deleteEvent,
  removeRole,
  updateEvent,
  updateRole
} from '../shared/projectMutations'

interface ProjectState {
  project: LedProject | null
  projectFilePath: string | null
  activeRoleId: string | null
  setProject: (project: LedProject, filePath?: string | null) => void
  newProject: (name?: string) => void
  loadDemo: (project: LedProject) => void
  setActiveRole: (roleId: string) => void
  activeRole: () => RoleDefinition | null
  addDancer: (roleId: string, displayName: string) => void
  removeDancer: (roleId: string) => void
  renameDancer: (roleId: string, displayName: string) => void
  addDancerEvent: (roleId: string, event: TimelineEventUI) => void
  updateDancerEvent: (roleId: string, eventId: string, patch: Partial<TimelineEventUI>) => void
  deleteDancerEvent: (roleId: string, eventId: string) => void
  updateProject: (updater: (p: LedProject) => LedProject) => void
  repairCurrentProject: () => void
  lastRepairFixes: string[]
}

function loadProject(project: LedProject): { project: LedProject; lastRepairFixes: string[] } {
  const migrated = migrateProjectToFiveOutputs(project)
  const repaired = repairProjectTimelineEvents(migrated.project)
  return {
    project: repaired.project,
    lastRepairFixes: [...migrated.fixes, ...repaired.fixes]
  }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  projectFilePath: null,
  activeRoleId: null,
  lastRepairFixes: [],

  setProject: (project, filePath = null) => {
    const loaded = loadProject(project)
    set({
      project: loaded.project,
      projectFilePath: filePath,
      activeRoleId: loaded.project.roles[0]?.role_id ?? null,
      lastRepairFixes: loaded.lastRepairFixes
    })
  },

  newProject: (name) => {
    const { project, lastRepairFixes } = loadProject(createDefaultShowProject(name ?? 'New Show'))
    set({
      project,
      projectFilePath: null,
      activeRoleId: project.roles[0]?.role_id ?? null,
      lastRepairFixes
    })
  },

  loadDemo: (project) => {
    const loaded = loadProject(project)
    set({
      project: loaded.project,
      projectFilePath: null,
      activeRoleId: loaded.project.roles[0]?.role_id ?? null,
      lastRepairFixes: loaded.lastRepairFixes
    })
  },

  setActiveRole: (roleId) => set({ activeRoleId: roleId }),

  activeRole: () => {
    const { project, activeRoleId } = get()
    if (!project || !activeRoleId) return null
    return project.roles.find((r) => r.role_id === activeRoleId) ?? null
  },

  addDancer: (roleId, displayName) => {
    const { project } = get()
    if (!project) return
    set({ project: addRole(project, roleId, displayName), activeRoleId: roleId })
  },

  removeDancer: (roleId) => {
    const { project, activeRoleId } = get()
    if (!project) return
    const next = removeRole(project, roleId)
    set({
      project: next,
      activeRoleId: activeRoleId === roleId ? (next.roles[0]?.role_id ?? null) : activeRoleId
    })
  },

  renameDancer: (roleId, displayName) => {
    const { project } = get()
    if (!project) return
    set({ project: updateRole(project, roleId, { display_name: displayName }) })
  },

  addDancerEvent: (roleId, event) => {
    const { project } = get()
    if (!project) return
    set({ project: addEvent(project, roleId, event) })
  },

  updateDancerEvent: (roleId, eventId, patch) => {
    const { project } = get()
    if (!project) return
    set({ project: updateEvent(project, roleId, eventId, patch) })
  },

  deleteDancerEvent: (roleId, eventId) => {
    const { project } = get()
    if (!project) return
    set({ project: deleteEvent(project, roleId, eventId) })
  },

  updateProject: (updater) => {
    const { project } = get()
    if (!project) return
    set({ project: updater(project) })
  },

  repairCurrentProject: () => {
    const { project } = get()
    if (!project) return
    const { project: repaired, fixes } = repairProjectTimelineEvents(project)
    if (fixes.length > 0) {
      set({ project: repaired, lastRepairFixes: fixes })
    }
  }
}))
