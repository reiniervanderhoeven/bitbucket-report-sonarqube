#!/usr/bin/env node
const program = require('commander')
const axios = require('axios')
const {version, name, description} = require('../package.json')
const fs = require('fs')

program.name(name)
  .version(version, '-v, --version')
  .requiredOption('-r, --reposlug <reposlug>')
  .requiredOption('-c, --commit <commit>')
  .requiredOption('-i, --reportId <reportId>')
  .requiredOption('-p, --projectName <projectName>')
  .option('-h, --host <host>')
  .option('-t, --token <token>')
  .description(description)
  .action(async () => {
    if (fs.existsSync('sonar-project.properties')) {
      const sonarProps = fs.readFileSync('sonar-project.properties')
      const properties = sonarProps.toString().split(/\r\n|\n/).map(prop => prop.split('='))
      if (!program.host) {
        const host = properties.find(prop => prop[0] === 'sonar.host.url')
        if (!host) {
          console.log('Missing host property')
          process.exit(1)
        }
        program.host = host[1]
      }
      if (!program.token) {
        const login = properties.find(prop => prop[0] === 'sonar.login')
        if (!login) {
          console.log('Missing token property')
          process.exit(1)
        }
        program.token = login[1]
      }
    }
    try {
      const res = await axios.get(`${program.host}/api/qualitygates/project_status?projectKey=${program.projectName}`, {
        auth: {
          username: program.token,
          password: ''
        }
      })
      const {projectStatus} = res.data

      const report = {
        title: 'Code quality report',
        details: `Code quality ${projectStatus.status === 'ERROR' ? 'FAILED' : 'PASSED'}`,
        report_type: 'BUG',
        reporter: 'AT',
        result: projectStatus.status === 'ERROR' ? 'FAILED' : 'PASSED',
        data: projectStatus.conditions.map((condition) => ({
          title: condition.metricKey,
          type: 'TEXT',
          value: condition.actualValue
        }))
      }

      await axios.delete(`https://api.bitbucket.org/2.0/repositories/${program.reposlug}/commit/${program.commit}/reports/${program.reportId}`, {
        proxy: {
          host: 'localhost',
          port: 29418
        }
      })

      console.log('deleted report')

      await axios.put(`https://api.bitbucket.org/2.0/repositories/${program.reposlug}/commit/${program.commit}/reports/${program.reportId}`,
        report, {
          proxy: {
            host: 'localhost',
            port: 29418
          }
        })

      console.log('created report')

      const response = await axios.get(`${program.host}/api/issues/search?resolved=false&componentKeys=${program.projectName}&ps=500`, {
        auth: {
          username: program.token,
          password: ''
        }
      })
      const issues = response.data.issues.map((issue) => {
        let severity = ''
        switch (issue.severity) {
          case 'BLOCKER':
            severity = 'CRITICAL'
            break
          case 'CRITICAL':
            severity = 'CRITICAL'
            break
          case 'MAJOR':
            severity = 'HIGH'
            break
          case 'MINOR':
            severity = 'MEDIUM'
            break
          case 'INFO':
            severity = 'LOW'
            break
        }
        return {
          external_id: issue.key,
          annotation_type: 'BUG',
          summary: issue.message,
          details: `effort: ${issue.effort}`,
          result: 'FAILED',
          severity,
          path: issue.component.split(':').pop(),
          line: issue.line
        }
      })

      if (issues.length > 0) {
        await axios.post(`https://api.bitbucket.org/2.0/repositories/${program.reposlug}/commit/${program.commit}/reports/${program.reportId}/annotations`,
            issues.slice(0,99), {
              proxy: {
                host: 'localhost',
                port: 29418
              }
            })
      }
    } catch (e) {
      e.response ? console.log(e.response.data) : console.log(e.message)
      process.exit(1)
    }
  })

program.parse(process.argv)
