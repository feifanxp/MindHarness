import React from 'react';
import { as, Box, Icon, IconButton, Icons, Text } from 'folds';
import classNames from 'classnames';
import Linkify from 'linkify-react';
import { PageScroll } from '../page';
import { Modal, Header } from '../glass/GlassPrimitives';
import * as css from './style.css';
import { LINKIFY_OPTS, scaleSystemEmoji } from '../../plugins/react-custom-html-parser';

export const RoomTopicViewer = as<
  'div',
  {
    name: string;
    topic: string;
    requestClose: () => void;
  }
>(({ name, topic, requestClose, className, ...props }, ref) => (
  <Modal
    size="300"
    flexHeight
    className={classNames(css.ModalFlex, className)}
    {...props}
    ref={ref}
  >
    <PageScroll
      header={
        <Header className={css.ModalHeader} variant="Surface" size="500">
          <Box grow="Yes">
            <Text size="H4" truncate>
              {name}
            </Text>
          </Box>
          <IconButton size="300" onClick={requestClose} radii="300">
            <Icon src={Icons.Cross} />
          </IconButton>
        </Header>
      }
    >
      <Box className={css.ModalContent} direction="Column" gap="100">
        <Text size="T300" className={css.ModalTopic} priority="400">
          <Linkify options={LINKIFY_OPTS}>{scaleSystemEmoji(topic)}</Linkify>
        </Text>
      </Box>
    </PageScroll>
  </Modal>
));
