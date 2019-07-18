import React, { Component } from 'react'
import PropTypes            from 'prop-types'
import { withRouter }       from 'react-router-dom'
import AppBar               from 'components/AppBar'
import Toolbar              from '@material-ui/core/Toolbar'
import Typography           from '@material-ui/core/Typography'
import { appConfig }        from 'configs/config-main'
import { styles }           from './styles.scss'

class Header extends Component {
  constructor(props) {
    super(props)

    this.state = {
      anchorEl: null
    }
  }

  handleClick = (event) => {
    this.setState({ anchorEl: event.currentTarget })
  }


  render() {

    return (
      <div className={styles}>
        <AppBar>
          <Toolbar>
            <Typography variant="title" color="inherit">
              {appConfig.name}
            </Typography>
          </Toolbar>
        </AppBar>
      </div>
    )
  }
}

Header.propTypes = {
  history: PropTypes.shape({}).isRequired
}

export default withRouter(Header)
