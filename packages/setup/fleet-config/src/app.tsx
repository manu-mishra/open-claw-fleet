import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { FleetConfig, DepartmentConfig, saveConfig, SkillInfo } from './config.js';

type Screen = 'env' | 'ceo' | 'departments' | 'department-detail' | 'skills';

interface Props {
  environments: string[];
  configs: Map<string, { path: string; config: FleetConfig }>;
  availableSkills: SkillInfo[];
  onCreateEnv: (name: string) => Promise<void>;
}

const DEPT_ORDER = ['Engineering', 'Sales', 'Marketing', 'Product', 'Operations', 'Customer Success', 'Finance', 'People', 'Legal'];

export function App({ environments, configs, availableSkills, onCreateEnv }: Props) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>('env');
  const [cursor, setCursor] = useState(0);
  const [selectedEnv, setSelectedEnv] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [config, setConfig] = useState<FleetConfig | null>(null);
  const [configPath, setConfigPath] = useState<string>('');
  const [newEnvName, setNewEnvName] = useState('');
  const [creatingEnv, setCreatingEnv] = useState(false);
  const [editingValue, setEditingValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [message, setMessage] = useState('');

  const save = () => {
    if (config && configPath) {
      saveConfig(configPath, config).then(() => {
        setMessage('Saved!');
        setTimeout(() => setMessage(''), 2000);
      });
    }
  };

  // Environment selection screen
  if (screen === 'env') {
    const items = [...environments, '+ Create new'];

    useInput((input, key) => {
      if (creatingEnv) {
        if (key.return && newEnvName.trim()) {
          onCreateEnv(newEnvName.trim()).then(() => {
            setCreatingEnv(false);
            setNewEnvName('');
          });
        } else if (key.escape) {
          setCreatingEnv(false);
          setNewEnvName('');
        } else if (key.backspace || key.delete) {
          setNewEnvName(newEnvName.slice(0, -1));
        } else if (input && !key.ctrl && !key.meta) {
          setNewEnvName(newEnvName + input);
        }
        return;
      }

      if (key.upArrow) setCursor(Math.max(0, cursor - 1));
      if (key.downArrow) setCursor(Math.min(items.length - 1, cursor + 1));
      if (key.return) {
        if (cursor === items.length - 1) {
          setCreatingEnv(true);
        } else {
          const env = environments[cursor];
          const data = configs.get(env)!;
          setSelectedEnv(env);
          setConfig(data.config);
          setConfigPath(data.path);
          setScreen('ceo');
          setCursor(0);
        }
      }
      if (input === 'q') exit();
    });

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">🦞 Open-Claw-Fleet Configuration</Text>
        <Text color="gray">Select environment</Text>
        <Box marginY={1} flexDirection="column">
          {items.map((item, i) => (
            <Text key={item} inverse={i === cursor} color={i === items.length - 1 ? 'yellow' : 'white'}>
              {i === cursor ? '▸ ' : '  '}{item}
            </Text>
          ))}
        </Box>
        {creatingEnv && (
          <Box><Text>Name: </Text><Text inverse>{newEnvName || ' '}</Text></Box>
        )}
        <Text color="gray">[↑↓] Navigate  [Enter] Select  [q] Quit</Text>
      </Box>
    );
  }

  // CEO configuration screen
  if (screen === 'ceo' && config) {
    const ceoName = config.ceo?.name || '';
    const ceoMatrixId = config.ceo?.matrixId || '';
    // Extract username from matrixId (remove @ and domain)
    const ceoUsername = ceoMatrixId.replace(/^@/, '').split(':')[0] || '';
    const domain = config.matrix.domain;
    
    const fields = [
      { label: 'Name', value: ceoName, key: 'name' },
      { label: 'Username', value: ceoUsername, key: 'username' },
    ];

    useInput((input, key) => {
      if (isEditing) {
        if (key.return) {
          const field = fields[cursor];
          setConfig(prev => {
            if (!prev) return null;
            
            if (field.key === 'name') {
              return {
                ...prev,
                ceo: {
                  name: editingValue,
                  matrixId: prev.ceo?.matrixId || `@:${domain}`
                }
              };
            } else if (field.key === 'username') {
              // Auto-generate matrixId from username
              const username = editingValue.toLowerCase().replace(/[^a-z0-9._-]/g, '.');
              return {
                ...prev,
                ceo: {
                  name: prev.ceo?.name || '',
                  matrixId: `@${username}:${domain}`
                }
              };
            }
            return prev;
          });
          setIsEditing(false);
          setEditingValue('');
        } else if (key.escape) {
          setIsEditing(false);
          setEditingValue('');
        } else if (key.backspace || key.delete) {
          setEditingValue(editingValue.slice(0, -1));
        } else if (input && !key.ctrl && !key.meta) {
          setEditingValue(editingValue + input);
        }
        return;
      }

      if (key.upArrow) setCursor(Math.max(0, cursor - 1));
      if (key.downArrow) setCursor(Math.min(fields.length - 1, cursor + 1));
      if (key.return) {
        setIsEditing(true);
        setEditingValue(fields[cursor].value);
      }
      if (input === 'n') { setScreen('departments'); setCursor(0); }
      if (input === 's') save();
      if (key.escape) { setScreen('env'); setCursor(0); }
      if (input === 'q') exit();
    });

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">🦞 CEO Configuration</Text>
        <Text color="gray">{selectedEnv}</Text>
        <Box marginY={1} flexDirection="column">
          <Text color="yellow">The CEO is the human who controls the AI workforce</Text>
          <Box marginTop={1} flexDirection="column">
            {fields.map((field, i) => (
              <Box key={field.key}>
                <Text inverse={i === cursor}>{i === cursor ? '▸ ' : '  '}{field.label.padEnd(12)}</Text>
                <Text color="white">
                  {isEditing && i === cursor ? (
                    <Text inverse>{editingValue || ' '}</Text>
                  ) : (
                    <>
                      {field.value}
                      {field.key === 'username' && <Text color="gray">@{domain}</Text>}
                    </>
                  )}
                </Text>
              </Box>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text color="gray">Matrix ID: </Text>
            <Text color="cyan">{`@${ceoUsername}:${domain}`}</Text>
          </Box>
        </Box>
        {message && <Text color="green">{message}</Text>}
        <Text color="gray">[↑↓] Nav [Enter] Edit [n] Next [s] Save [Esc] Back [q] Quit</Text>
      </Box>
    );
  }

  // Department list screen
  if (screen === 'departments' && config) {
    const deptNames = DEPT_ORDER.filter(d => d in config.departments);
    const totalAgents = Object.values(config.departments)
      .filter(d => d.enabled)
      .reduce((sum, d) => sum + d.vp + d.directors + d.managers + d.ics, 0);

    useInput((input, key) => {
      if (key.upArrow) setCursor(Math.max(0, cursor - 1));
      if (key.downArrow) setCursor(Math.min(deptNames.length - 1, cursor + 1));
      if (input === ' ') {
        const dept = deptNames[cursor];
        setConfig(prev => prev && ({
          ...prev,
          departments: { ...prev.departments, [dept]: { ...prev.departments[dept], enabled: !prev.departments[dept].enabled } }
        }));
      }
      if (key.return) {
        setSelectedDept(deptNames[cursor]);
        setScreen('department-detail');
        setCursor(0);
      }
      if (input === 's') save();
      if (key.escape) { setScreen('env'); setCursor(0); }
      if (input === 'q') exit();
    });

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">🦞 {selectedEnv}</Text>
        <Box marginY={1} flexDirection="column">
          {deptNames.map((name, i) => {
            const dept = config.departments[name];
            return (
              <Box key={name} flexDirection="column">
                <Text inverse={i === cursor} color={dept.enabled ? 'green' : 'gray'}>
                  {i === cursor ? '▸ ' : '  '}{name.padEnd(18)} {dept.enabled ? '[✓]' : '[ ]'}
                </Text>
                {dept.enabled && (
                  <Text color="gray">    VP:{dept.vp} Dir:{dept.directors} Mgr:{dept.managers} IC:{dept.ics}</Text>
                )}
              </Box>
            );
          })}
        </Box>
        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Text>Total: <Text bold color="yellow">{totalAgents}</Text> agents</Text>
        </Box>
        {message && <Text color="green">{message}</Text>}
        <Text color="gray">[↑↓] Nav [Space] Toggle [Enter] Config [s] Save [Esc] Back [q] Quit</Text>
      </Box>
    );
  }

  // Department detail screen
  if (screen === 'department-detail' && config && selectedDept) {
    const dept = config.departments[selectedDept];
    const deptSkills = dept.skills || config.defaults.skills || [];
    const fields = [
      { label: 'Enabled', value: dept.enabled ? 'Yes' : 'No', type: 'toggle' },
      { label: 'VPs', value: String(dept.vp), type: 'number' },
      { label: 'Directors', value: String(dept.directors), type: 'number' },
      { label: 'Managers', value: String(dept.managers), type: 'number' },
      { label: 'ICs', value: String(dept.ics), type: 'number' },
      { label: 'Skills', value: deptSkills.join(', ') || '(default)', type: 'skills' },
    ];

    useInput((input, key) => {
      if (isEditing) {
        if (key.return) {
          const val = parseInt(editingValue, 10) || 0;
          const fieldMap: Record<string, keyof DepartmentConfig> = { 'VPs': 'vp', 'Directors': 'directors', 'Managers': 'managers', 'ICs': 'ics' };
          const k = fieldMap[fields[cursor].label];
          if (k) {
            setConfig(prev => prev && ({
              ...prev,
              departments: { ...prev.departments, [selectedDept]: { ...prev.departments[selectedDept], [k]: val } }
            }));
          }
          setIsEditing(false);
          setEditingValue('');
        } else if (key.escape) {
          setIsEditing(false);
          setEditingValue('');
        } else if (key.backspace || key.delete) {
          setEditingValue(editingValue.slice(0, -1));
        } else if (/^\d$/.test(input)) {
          setEditingValue(editingValue + input);
        }
        return;
      }

      if (key.upArrow) setCursor(Math.max(0, cursor - 1));
      if (key.downArrow) setCursor(Math.min(fields.length - 1, cursor + 1));

      const field = fields[cursor];
      if (key.return || input === ' ') {
        if (field.type === 'toggle') {
          setConfig(prev => prev && ({
            ...prev,
            departments: { ...prev.departments, [selectedDept]: { ...prev.departments[selectedDept], enabled: !dept.enabled } }
          }));
        } else if (field.type === 'number') {
          setIsEditing(true);
          setEditingValue(field.value);
        } else if (field.type === 'skills') {
          setScreen('skills');
          setCursor(0);
        }
      }
      if (key.escape) { setScreen('departments'); setCursor(DEPT_ORDER.indexOf(selectedDept)); }
      if (input === 's') save();
      if (input === 'q') exit();
    });

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">🦞 {selectedDept}</Text>
        <Text color="gray">{selectedEnv}</Text>
        <Box marginY={1} flexDirection="column">
          {fields.map((field, i) => (
            <Box key={field.label}>
              <Text inverse={i === cursor}>{i === cursor ? '▸ ' : '  '}{field.label.padEnd(12)}</Text>
              <Text color={field.type === 'toggle' ? (dept.enabled ? 'green' : 'red') : 'white'}>
                {isEditing && i === cursor ? <Text inverse>{editingValue || '0'}</Text> : field.value}
              </Text>
            </Box>
          ))}
        </Box>
        {message && <Text color="green">{message}</Text>}
        <Text color="gray">[↑↓] Nav [Enter] Edit [s] Save [Esc] Back [q] Quit</Text>
      </Box>
    );
  }

  // Skills selection screen
  if (screen === 'skills' && config && selectedDept) {
    const dept = config.departments[selectedDept];
    const deptSkills = new Set(dept.skills || config.defaults.skills || []);

    useInput((input, key) => {
      if (key.upArrow) setCursor(Math.max(0, cursor - 1));
      if (key.downArrow) setCursor(Math.min(availableSkills.length - 1, cursor + 1));
      if (input === ' ' || key.return) {
        const skill = availableSkills[cursor].name;
        const newSkills = new Set(deptSkills);
        if (newSkills.has(skill)) newSkills.delete(skill);
        else newSkills.add(skill);
        setConfig(prev => prev && ({
          ...prev,
          departments: { ...prev.departments, [selectedDept]: { ...prev.departments[selectedDept], skills: [...newSkills] } }
        }));
      }
      if (key.escape) { setScreen('department-detail'); setCursor(5); }
      if (input === 's') save();
      if (input === 'q') exit();
    });

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">🦞 {selectedDept} Skills</Text>
        <Text color="gray">Select skills for this department</Text>
        <Box marginY={1} flexDirection="column">
          {availableSkills.map((skill, i) => {
            const enabled = deptSkills.has(skill.name);
            return (
              <Box key={skill.name}>
                <Text inverse={i === cursor} color={enabled ? 'green' : 'gray'}>
                  {i === cursor ? '▸ ' : '  '}{skill.emoji || '📦'} {skill.name.padEnd(18)} {enabled ? '[✓]' : '[ ]'}
                </Text>
              </Box>
            );
          })}
        </Box>
        {message && <Text color="green">{message}</Text>}
        <Text color="gray">[↑↓] Nav [Space] Toggle [s] Save [Esc] Back [q] Quit</Text>
      </Box>
    );
  }

  return <Text>Loading...</Text>;
}
