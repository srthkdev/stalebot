'use client'

import React, { useState } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { LoadingSpinner } from '../ui/LoadingSpinner'

interface RuleManagementProps {
  repositoryId: string
  repositoryName: string
}

interface RuleFormData {
  name: string
  inactivityDays: number
  labels: string[]
  issueStates: ('open' | 'closed')[]
  assigneeCondition: 'any' | 'assigned' | 'unassigned' | 'specific'
  specificAssignees: string[]
}

export function RuleManagement({ repositoryId, repositoryName }: RuleManagementProps) {
  const rules = useQuery(api.userRules.getRulesForRepository, { repositoryId: repositoryId as any })
  const createRule = useMutation(api.rules.createRule)
  const updateRule = useMutation(api.rules.updateRule)
  const deleteRule = useMutation(api.rules.deleteRule)
  
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingRule, setEditingRule] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const [formData, setFormData] = useState<RuleFormData>({
    name: '',
    inactivityDays: 30,
    labels: [],
    issueStates: ['open'],
    assigneeCondition: 'any',
    specificAssignees: [],
  })

  const resetForm = () => {
    setFormData({
      name: '',
      inactivityDays: 30,
      labels: [],
      issueStates: ['open'],
      assigneeCondition: 'any',
      specificAssignees: [],
    })
    setShowCreateForm(false)
    setEditingRule(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) return

    try {
      setIsSubmitting(true)
      
      const ruleData = {
        repositoryId: repositoryId as any,
        name: formData.name.trim(),
        inactivityDays: formData.inactivityDays,
        labels: formData.labels,
        issueStates: formData.issueStates,
        assigneeCondition: formData.assigneeCondition === 'specific' 
          ? formData.specificAssignees 
          : formData.assigneeCondition,
      }

      if (editingRule) {
        await updateRule({
          ruleId: editingRule as any,
          updates: ruleData,
        })
      } else {
        await createRule(ruleData)
      }

      resetForm()
    } catch (error) {
      console.error('Failed to save rule:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEdit = (rule: any) => {
    setFormData({
      name: rule.name,
      inactivityDays: rule.inactivityDays,
      labels: rule.labels,
      issueStates: rule.issueStates,
      assigneeCondition: Array.isArray(rule.assigneeCondition) ? 'specific' : rule.assigneeCondition,
      specificAssignees: Array.isArray(rule.assigneeCondition) ? rule.assigneeCondition : [],
    })
    setEditingRule(rule._id)
    setShowCreateForm(true)
  }

  const handleDelete = async (ruleId: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return
    
    try {
      await deleteRule({ ruleId: ruleId as any })
    } catch (error) {
      console.error('Failed to delete rule:', error)
    }
  }

  const handleLabelInput = (value: string) => {
    const labels = value.split(',').map(l => l.trim()).filter(l => l.length > 0)
    setFormData(prev => ({ ...prev, labels }))
  }

  const handleAssigneeInput = (value: string) => {
    const assignees = value.split(',').map(a => a.trim()).filter(a => a.length > 0)
    setFormData(prev => ({ ...prev, specificAssignees: assignees }))
  }

  if (rules === undefined) {
    return (
      <div className="flex items-center justify-center py-4">
        <LoadingSpinner size="sm" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-gray-900">
          Stale Detection Rules for {repositoryName}
        </h4>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="btn-primary text-sm"
        >
          {showCreateForm ? 'Cancel' : 'Add Rule'}
        </button>
      </div>

      {/* Create/Edit Form */}
      {showCreateForm && (
        <form onSubmit={handleSubmit} className="bg-gray-50 rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rule Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="input"
                placeholder="e.g., Bug issues after 30 days"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Inactivity Days *
              </label>
              <input
                type="number"
                min="1"
                max="365"
                value={formData.inactivityDays}
                onChange={(e) => setFormData(prev => ({ ...prev, inactivityDays: parseInt(e.target.value) }))}
                className="input"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Labels (comma-separated, leave empty for all)
            </label>
            <input
              type="text"
              value={formData.labels.join(', ')}
              onChange={(e) => handleLabelInput(e.target.value)}
              className="input"
              placeholder="bug, enhancement, help wanted"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Issue States
            </label>
            <div className="flex space-x-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.issueStates.includes('open')}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setFormData(prev => ({ ...prev, issueStates: [...prev.issueStates, 'open'] }))
                    } else {
                      setFormData(prev => ({ ...prev, issueStates: prev.issueStates.filter(s => s !== 'open') }))
                    }
                  }}
                  className="mr-2"
                />
                Open Issues
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.issueStates.includes('closed')}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setFormData(prev => ({ ...prev, issueStates: [...prev.issueStates, 'closed'] }))
                    } else {
                      setFormData(prev => ({ ...prev, issueStates: prev.issueStates.filter(s => s !== 'closed') }))
                    }
                  }}
                  className="mr-2"
                />
                Closed Issues
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Assignee Condition
            </label>
            <div className="space-y-2">
              {[
                { value: 'any', label: 'Any (assigned or unassigned)' },
                { value: 'assigned', label: 'Only assigned issues' },
                { value: 'unassigned', label: 'Only unassigned issues' },
                { value: 'specific', label: 'Specific assignees' },
              ].map((option) => (
                <label key={option.value} className="flex items-center">
                  <input
                    type="radio"
                    name="assigneeCondition"
                    value={option.value}
                    checked={formData.assigneeCondition === option.value}
                    onChange={(e) => setFormData(prev => ({ ...prev, assigneeCondition: e.target.value as any }))}
                    className="mr-2"
                  />
                  {option.label}
                </label>
              ))}
            </div>

            {formData.assigneeCondition === 'specific' && (
              <div className="mt-2">
                <input
                  type="text"
                  value={formData.specificAssignees.join(', ')}
                  onChange={(e) => handleAssigneeInput(e.target.value)}
                  className="input"
                  placeholder="username1, username2"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={resetForm}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !formData.name.trim() || formData.issueStates.length === 0}
              className="btn-primary disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  {editingRule ? 'Updating...' : 'Creating...'}
                </>
              ) : (
                editingRule ? 'Update Rule' : 'Create Rule'
              )}
            </button>
          </div>
        </form>
      )}

      {/* Rules List */}
      {rules.length === 0 ? (
        <div className="text-center py-6 text-gray-500">
          No rules configured. Add a rule to start detecting stale issues.
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div key={rule._id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3">
                    <h5 className="font-medium text-gray-900">{rule.name}</h5>
                    {!rule.isActive && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        Inactive
                      </span>
                    )}
                  </div>
                  
                  <div className="mt-2 text-sm text-gray-600 space-y-1">
                    <div>
                      <span className="font-medium">Inactivity:</span> {rule.inactivityDays} days
                    </div>
                    <div>
                      <span className="font-medium">States:</span> {rule.issueStates.join(', ')}
                    </div>
                    {rule.labels.length > 0 && (
                      <div>
                        <span className="font-medium">Labels:</span> {rule.labels.join(', ')}
                      </div>
                    )}
                    <div>
                      <span className="font-medium">Assignees:</span>{' '}
                      {Array.isArray(rule.assigneeCondition) 
                        ? rule.assigneeCondition.join(', ')
                        : rule.assigneeCondition
                      }
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleEdit(rule)}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(rule._id)}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}