### Install docker

https://docs.docker.com/install/linux/docker-ce/ubuntu/

### Filebeat

Install using a method from

https://www.elastic.co/guide/en/beats/filebeat/current/filebeat-installation.html

Configure the filebeat config setting at least the following flags in the filebeat.yml (usually at /etc/filebeat/filebeat.yml), and commenting out the output.elasticsearch

```
filebeat.inputs:
- type: log
  enabled: true
# only include info logs as they contain both errors and info detail
  paths:
    - <path to logs folder>/*info.log


filebeat.config.modules:
  reload.enabled: true

output.logstash:
  hosts: ["<insert logstash url here>"]

```

Run filebeat and set to start automatically.
https://www.elastic.co/guide/en/beats/filebeat/current/running-with-systemd.html

### Install java

On Debian/Ubuntu: `apt-get install default-jdk`

### Logstash

Install using a method from:

https://www.elastic.co/guide/en/logstash/current/installing-logstash.html

Create a config in logstash configs file (usually /etc/logstash/conf.d) of the form and called `pisa.conf`:
```
input {
  beats {
    port => "5044"
  }
}
filter {
  prune {
    whitelist_names => ["^message$"]
  }
  json {
    source => "message"
    remove_field => ["message"]
  }
  date {
    match => ["time", "yyyy-MM-dd'T'HH:mm:ss'.'SSSZ"]
    target => "@timestamp"
    remove_field => ["time"]
  }
  if([req][remoteAddress]) {
    geoip {
        source => "[req][remoteAddress]"
    }
  }
}
output {
  elasticsearch {
    hosts => ["<insert url here>"]
    index => "logstash-%{+xxxx.ww}"
    manage_template => true
  }
}
```
We use a logstash-* index name since elasticsearch has pre-configured mapping for logstash, including those for geoip which we use.

Set the following in /etc/logstash/logstash.yml, to enable us to edit the config with restarting:
```
config.reload.automatic: true
config.reload.interval: 10s
```

Run logstash, and set to restart automatically on server restart
https://www.elastic.co/guide/en/logstash/7.x/running-logstash.html#running-logstash-systemd

```
sudo systemctl start logstash.service
sudo systemctl enable logstash.service
```